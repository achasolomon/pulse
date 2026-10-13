import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  FINDING_REPOSITORY,
  findingStatusAction,
  validateFindingSeverity,
  type FindingAction,
  type FindingRepository,
  type FindingSeverity,
  type FindingStatus,
} from '../domain/finding.repository.js';

/**
 * Penetration-test / security finding intake and triage (F22.1,
 * SEC-001 section 86 vulnerability gate). Closed states are terminal: a
 * regression is a NEW finding, never a silent reopen (evidence chain).
 */
@Injectable()
export class FindingService {
  constructor(
    @Inject(FINDING_REPOSITORY) private readonly repo: FindingRepository,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    title: string;
    severity: string;
    component: string;
    vector?: string;
    evidence?: string;
    owner?: string;
    remediation?: string;
    dueAt?: string;
    correlationId?: string;
  }) {
    const title = (input.title ?? '').trim();
    if (title.length < 5 || title.length > 200) {
      throw new BadRequestException({
        code: 'FINDING_TITLE_INVALID',
        message: 'title must be 5-200 characters',
      });
    }
    const component = (input.component ?? '').trim();
    if (component.length < 2 || component.length > 100) {
      throw new BadRequestException({
        code: 'FINDING_COMPONENT_INVALID',
        message: 'component must be 2-100 characters',
      });
    }
    let severity: FindingSeverity;
    try {
      severity = validateFindingSeverity(input.severity ?? '');
    } catch {
      throw new BadRequestException({
        code: 'FINDING_SEVERITY_INVALID',
        message: 'severity must be info|low|medium|high|critical',
      });
    }
    if (input.dueAt !== undefined && Number.isNaN(Date.parse(input.dueAt))) {
      throw new BadRequestException({
        code: 'FINDING_DUE_INVALID',
        message: 'dueAt must be an ISO timestamp',
      });
    }
    const finding = await this.repo.create({
      title,
      severity,
      component,
      ...(input.vector ? { vector: input.vector } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.remediation ? { remediation: input.remediation } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'security_finding',
      aggregateId: finding.id,
      type: 'security.finding_intaken',
      producer: 'security',
      correlationId: input.correlationId,
      payload: { id: finding.id, severity: finding.severity, component: finding.component },
    });
    return finding;
  }

  list(filter?: { status?: FindingStatus; severity?: FindingSeverity }) {
    return this.repo.list(filter);
  }

  async get(id: string) {
    const finding = await this.repo.findById(id);
    if (!finding) {
      throw new NotFoundException({ code: 'FINDING_NOT_FOUND', message: 'Unknown finding id' });
    }
    return finding;
  }

  async act(
    id: string,
    action: FindingAction,
    input: {
      owner?: string;
      remediation?: string;
      triagedBy?: string;
      correlationId?: string;
    } = {},
  ) {
    const finding = await this.get(id);
    const next = findingStatusAction(finding.status, action);
    if (!next) {
      throw new ConflictException({
        code: 'FINDING_TRANSITION',
        message: `Cannot ${action} a finding in status ${finding.status} (closed findings are terminal; intake a new finding for regressions)`,
      });
    }
    const at = new Date();
    await this.repo.transition(id, next, {
      at,
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.remediation ? { remediation: input.remediation } : {}),
      ...(input.triagedBy ? { triagedBy: input.triagedBy } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'security_finding',
      aggregateId: id,
      type: `security.finding_${next}`,
      producer: 'security',
      correlationId: input.correlationId,
      payload: { id, status: next },
    });
    return {
      ...finding,
      status: next,
      triagedAt: at.toISOString(),
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.triagedBy ? { triagedBy: input.triagedBy } : {}),
      ...(input.remediation ? { remediation: input.remediation } : {}),
    };
  }
}
