import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  BLOODBANK_REPOSITORY,
  isCompatible,
  transitionUnit,
  type ABO,
  type BloodbankRepository,
  type Rh,
} from '../domain/bloodbank.repository.js';

/** Blood bank application service (R6). Incompatibility can never proceed. */
@Injectable()
export class BloodbankService {
  constructor(
    @Inject(BLOODBANK_REPOSITORY) private readonly repo: BloodbankRepository,
    private readonly outbox: OutboxService,
  ) {}

  registerUnit(input: { bagId: string; abo: ABO; rh: Rh; expiresOn: string }) {
    return this.repo.registerUnit(input);
  }

  private async moveUnit(
    id: string,
    action: 'test' | 'release' | 'reserve' | 'issue' | 'transfuse' | 'expire' | 'discard',
    event: string,
    opts: { correlationId?: string } = {},
  ) {
    const unit = await this.repo.findUnit(id);
    if (!unit) {
      throw new NotFoundException({ code: 'BANK_UNIT_NOT_FOUND', message: 'Unit not found' });
    }
    let status;
    try {
      status = transitionUnit(unit.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'BANK_TRANSITION',
        message: `Illegal transition: ${unit.status} -> ${action}`,
      });
    }
    await this.repo.setUnitStatus(id, status);
    await this.outbox.publish({
      aggregateType: 'blood_unit',
      aggregateId: id,
      type: event,
      producer: 'bloodbank',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  testUnit(id: string, opts: { correlationId?: string } = {}) {
    return this.moveUnit(id, 'test', 'blood.tested', opts);
  }

  releaseUnit(id: string, opts: { correlationId?: string } = {}) {
    return this.moveUnit(id, 'release', 'blood.released', opts);
  }

  /**
   * Crossmatch: records the verdict first (the check itself is evidence),
   * reserves on compatibility, refuses with 422 on incompatibility.
   * Recipient group is clinician-stated (from record); a patient blood-group
   * registry lands with the donor module.
   */
  async crossmatch(input: {
    patientId: string;
    unitId: string;
    recipientAbo: ABO;
    recipientRh: Rh;
    performedBy?: string;
    correlationId?: string;
  }) {
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit) {
      throw new NotFoundException({ code: 'BANK_UNIT_NOT_FOUND', message: 'Unit not found' });
    }
    if (unit.expiresOn && unit.expiresOn < new Date().toISOString().slice(0, 10)) {
      throw new UnprocessableEntityException({
        code: 'BANK_UNIT_EXPIRED',
        message: 'Expired units cannot be crossmatched',
      });
    }
    const compatible = isCompatible(
      { abo: unit.abo, rh: unit.rh },
      { abo: input.recipientAbo, rh: input.recipientRh },
    );
    await this.repo.recordCrossmatch({
      patientId: input.patientId,
      unitId: input.unitId,
      result: compatible ? 'compatible' : 'incompatible',
      ...(input.performedBy ? { performedBy: input.performedBy } : {}),
    });
    if (!compatible) {
      throw new UnprocessableEntityException({
        code: 'BANK_INCOMPATIBLE',
        message: 'Incompatible blood group — issue blocked',
      });
    }
    if (unit.status === 'available') {
      await this.repo.setUnitStatus(input.unitId, 'reserved');
    }
    await this.outbox.publish({
      aggregateType: 'blood_unit',
      aggregateId: input.unitId,
      type: 'blood.crossmatched',
      producer: 'bloodbank',
      correlationId: input.correlationId,
      payload: { id: input.unitId, compatible: true },
    });
    return { unitId: input.unitId, compatible: true as const };
  }

  async issue(input: { unitId: string; patientId: string; correlationId?: string }) {
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit) {
      throw new NotFoundException({ code: 'BANK_UNIT_NOT_FOUND', message: 'Unit not found' });
    }
    const latest = await this.repo.latestCrossmatch(input.patientId, input.unitId);
    if (!latest || latest.result !== 'compatible') {
      throw new UnprocessableEntityException({
        code: 'BANK_CROSSMATCH_REQUIRED',
        message: 'A compatible crossmatch is required before issue',
      });
    }
    return this.moveUnit(input.unitId, 'issue', 'blood.issued', {
      correlationId: input.correlationId,
    });
  }

  async startTransfusion(input: {
    patientId: string;
    encounterId?: string;
    unitId: string;
    correlationId?: string;
  }) {
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit || unit.status !== 'issued') {
      throw new UnprocessableEntityException({
        code: 'BANK_NOT_ISSUED',
        message: 'Only issued units can start transfusion',
      });
    }
    const txn = await this.repo.startTransfusion(input);
    await this.repo.setUnitStatus(input.unitId, 'transfused');
    await this.outbox.publish({
      aggregateType: 'transfusion',
      aggregateId: txn.id,
      type: 'transfusion.started',
      producer: 'bloodbank',
      correlationId: input.correlationId,
      payload: { id: txn.id },
    });
    return txn;
  }

  async finishTransfusion(
    id: string,
    outcome: { reaction?: 'none' | 'mild' | 'moderate' | 'severe'; note?: string; correlationId?: string },
  ) {
    const stopped = outcome.reaction !== undefined && outcome.reaction !== 'none';
    if (stopped && !outcome.note) {
      throw new BadRequestException({
        code: 'REACTION_NOTE_REQUIRED',
        message: 'Stopped transfusions require a reaction report note',
      });
    }
    await this.repo.finishTransfusion(id, {
      status: stopped ? 'stopped' : 'completed',
      ...(outcome.reaction ? { reaction: outcome.reaction } : {}),
      ...(outcome.note ? { note: outcome.note } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'transfusion',
      aggregateId: id,
      type: stopped ? 'transfusion.reaction' : 'transfusion.completed',
      producer: 'bloodbank',
      correlationId: outcome.correlationId,
      payload: { id, stopped },
    });
    return { id, stopped };
  }
}
