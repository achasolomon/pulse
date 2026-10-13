import { Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { metricsRegistry } from '../../../platform/observability/metrics.registry.js';
import {
  SRE_REPOSITORY,
  backupStalenessMinutes,
  breaches,
  errorRate,
  type AlertRule,
  type SreRepository,
} from '../domain/sre.repository.js';

/**
 * Alert evaluation (OPS-001 43-44, F23.1). Stateless evaluation over
 * enabled rules: breach opens a firing alert (deduped per rule — one
 * firing instance), recovery resolves it. Every transition emits outbox
 * facts for downstream paging; rules carry severity + owner + runbook.
 */
@Injectable()
export class AlertService {
  constructor(
    @Inject(SRE_REPOSITORY) private readonly repo: SreRepository,
    private readonly outbox: OutboxService,
  ) {}

  rules(enabledOnly = false) {
    return this.repo.listRules(enabledOnly);
  }

  alerts(filter?: { state?: 'firing' | 'resolved'; limit?: number }) {
    return this.repo.listAlerts(filter);
  }

  async evaluate(opts: { correlationId?: string } = {}) {
    const rules = await this.repo.listRules(true);
    const results: { rule: string; value: number; breached: boolean; state: 'firing' | 'resolved' | 'unchanged' }[] = [];
    for (const rule of rules) {
      const value = await this.value(rule);
      const fired = await this.repo.findFiring(rule.id);
      const breached = breaches(value, rule.comparator, rule.threshold);
      if (breached && !fired) {
        const alert = await this.repo.openAlert({
          ruleId: rule.id,
          value,
          detail: { metric: rule.metric, threshold: rule.threshold, comparator: rule.comparator },
        });
        await this.outbox.publish({
          aggregateType: 'sre_alert',
          aggregateId: alert.id,
          type: 'sre.alert_firing',
          producer: 'sre',
          correlationId: opts.correlationId,
          payload: { alertId: alert.id, rule: rule.name, severity: rule.severity, owner: rule.owner, value },
        });
        results.push({ rule: rule.name, value, breached, state: 'firing' });
      } else if (breached && fired) {
        await this.repo.updateAlertValue(fired.id, value);
        results.push({ rule: rule.name, value, breached, state: 'unchanged' });
      } else if (!breached && fired) {
        await this.repo.resolveAlert(fired.id, value);
        await this.outbox.publish({
          aggregateType: 'sre_alert',
          aggregateId: fired.id,
          type: 'sre.alert_resolved',
          producer: 'sre',
          correlationId: opts.correlationId,
          payload: { alertId: fired.id, rule: rule.name, value },
        });
        results.push({ rule: rule.name, value, breached, state: 'resolved' });
      } else {
        results.push({ rule: rule.name, value, breached, state: 'unchanged' });
      }
    }
    return { evaluated: rules.length, results };
  }

  private async value(rule: AlertRule): Promise<number> {
    if (rule.metric === 'error_rate') {
      const snap = metricsRegistry.snapshot();
      return errorRate(snap.serverErrors, snap.totalRequests);
    }
    const last = await this.repo.lastSucceededFullBackup();
    return backupStalenessMinutes(last);
  }
}
