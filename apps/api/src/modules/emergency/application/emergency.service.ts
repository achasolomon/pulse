import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { ENCOUNTER_REPOSITORY, type EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import { EncounterService } from '../../encounter/application/encounter.service.js';
import {
  EMERGENCY_REPOSITORY,
  orderWaitingList,
  type AcuityLevel,
  type EmergencyRepository,
  type WaitingEntry,
} from '../domain/emergency.repository.js';

/** Emergency application service (R6 slice). Acuity assists; disposition stays governed. */
@Injectable()
export class EmergencyService {
  constructor(
    @Inject(EMERGENCY_REPOSITORY) private readonly repo: EmergencyRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters: EncounterRepository,
    private readonly encounterService: EncounterService,
    private readonly outbox: OutboxService,
  ) {}

  async score(input: {
    encounterId: string;
    level: AcuityLevel;
    discriminator: string;
    overrideReason?: string;
    recordedBy?: string;
    correlationId?: string;
  }) {
    if (!input.discriminator) {
            throw new BadRequestException({
        code: 'ACUITY_DISCRIMINATOR_REQUIRED',
        message: 'Acuity requires a discriminator (what drove the score)',
      });
    }
    const encounter = await this.encounters.findById(input.encounterId);
    if (!encounter || encounter.type !== 'emergency') {
      throw new UnprocessableEntityException({
        code: 'ACUITY_EMERGENCY_ONLY',
        message: 'Acuity scoring applies to emergency encounters',
      });
    }
    const score = await this.repo.recordAcuity(input);
    await this.outbox.publish({
      aggregateType: 'encounter',
      aggregateId: input.encounterId,
      type: 'emergency.scored',
      producer: 'emergency',
      correlationId: input.correlationId,
      payload: { id: input.encounterId, level: input.level },
    });
    return score;
  }

  async waiting(facilityId: string): Promise<{ entries: WaitingEntry[] }> {
    const rows = await this.repo.waitingList(facilityId, 100);
    const byId = new Map(rows.map((r) => [r.encounterId, r]));
    const ordered = orderWaitingList(
      rows.map((r) => ({
        encounterId: r.encounterId,
        ...(r.acuity !== undefined ? { acuity: r.acuity } : {}),
        arrivedAt: r.arrivedAt,
      })),
    );
    return {
      entries: ordered.map((o) => ({
        encounterId: o.encounterId,
        patientId: byId.get(o.encounterId)?.patientId ?? '',
        acuity: o.acuity as WaitingEntry['acuity'],
        arrivedAt: o.arrivedAt,
        waitingMinutes: o.waitingMinutes,
        status: byId.get(o.encounterId)?.status ?? '',
      })),
    };
  }

  /**
   * Emergency discharge with the acuity guardrail: no disposition without a
   * recorded acuity score on emergency encounters.
   */
  async dischargeWithAcuity(
    encounterId: string,
    opts: { disposition?: string; correlationId?: string },
  ) {
    const encounter = await this.encounters.findById(encounterId);
    if (encounter?.type === 'emergency') {
      const acuity = await this.repo.latestAcuity(encounterId);
      if (!acuity) {
        throw new UnprocessableEntityException({
          code: 'ACUITY_REQUIRED',
          message: 'Emergency encounters require an acuity score before disposition',
        });
      }
    }
    return this.encounterService.discharge(encounterId, opts);
  }
}
