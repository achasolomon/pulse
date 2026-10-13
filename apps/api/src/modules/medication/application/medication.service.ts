import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  MEDICATION_REPOSITORY,
  transitionMedication,
  type AdminOutcome,
  type MedicationRepository,
} from '../domain/medication.repository.js';

/** Medication application service (EPIC-12 F12.1–F12.6). Verify-before-dispense, dispense-before-administer. */
@Injectable()
export class MedicationService {
  constructor(
    @Inject(MEDICATION_REPOSITORY) private readonly repo: MedicationRepository,
    private readonly outbox: OutboxService,
  ) {}

  defineMedication(input: {
    code: string;
    name: string;
    doseForm: string;
    strength: string;
    route: string;
  }) {
    return this.repo.defineMedication(input);
  }

  async prescribe(input: {
    patientId: string;
    encounterId: string;
    medicationCode: string;
    dose: string;
    doseUnit: string;
    route: string;
    frequency: string;
    correlationId?: string;
  }) {
    const med = await this.repo.findMedication(input.medicationCode);
    if (!med) {
      throw new BadRequestException({
        code: 'UNKNOWN_MEDICATION',
        message: `No active catalogue entry for ${input.medicationCode}`,
      });
    }
    if (!input.dose || !input.route || !input.frequency) {
      throw new BadRequestException({
        code: 'DOSE_REQUIRED',
        message: 'Dose, route and frequency are structured and required',
      });
    }
    const req = await this.repo.prescribe({
      patientId: input.patientId,
      encounterId: input.encounterId,
      medicationId: med.id,
      dose: input.dose,
      doseUnit: input.doseUnit,
      route: input.route,
      frequency: input.frequency,
    });
    await this.outbox.publish({
      aggregateType: 'med_request',
      aggregateId: req.id,
      type: 'med.prescribed',
      producer: 'medication',
      correlationId: input.correlationId,
      payload: { id: req.id },
    });
    return req;
  }

  private async move(
    id: string,
    action: 'verify' | 'dispense' | 'complete' | 'hold' | 'resume' | 'cancel',
    event: string,
    opts: {
      quantity?: string;
      batch?: string;
      reason?: string;
      correlationId?: string;
      detail?: Record<string, unknown>;
    } = {},
  ) {
    const current = await this.repo.findRequest(id);
    if (!current) {
      throw new NotFoundException({ code: 'MED_REQUEST_NOT_FOUND', message: 'Medication request not found' });
    }
    let status;
    try {
      status = transitionMedication(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'MED_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    if (action === 'dispense' && (!opts.quantity || !opts.batch)) {
      throw new BadRequestException({
        code: 'DISPENSE_REQUIRED',
        message: 'Quantity and batch are required for dispensing',
      });
    }
    if (action === 'dispense') {
      await this.repo.dispense(id, { quantity: opts.quantity ?? '', batch: opts.batch ?? '' });
    }
    await this.repo.setStatus(
      id,
      status,
      ['hold', 'cancel'].includes(action) && opts.reason ? { holdReason: opts.reason, cancelReason: opts.reason } : undefined,
    );
    const payload: Record<string, unknown> = { id, status };
    if (opts.detail) Object.assign(payload, opts.detail);
    await this.outbox.publish({
      aggregateType: 'med_request',
      aggregateId: id,
      type: event,
      producer: 'medication',
      correlationId: opts.correlationId,
      payload,
    });
    return { id, status };
  }

  verify(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'verify', 'med.verified', opts);
  }

  async dispense(id: string, opts: { quantity: string; batch: string; correlationId?: string }) {
    // Billing context for the projector (additive payload detail).
    const context = await this.repo.contextForRequest(id);
    return this.move(id, 'dispense', 'med.dispensed', {
      ...opts,
      ...(context
        ? {
            detail: {
              patientId: context.patientId,
              encounterId: context.encounterId,
              medicationCode: context.medicationCode,
            },
          }
        : {}),
    });
  }

  hold(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'hold', 'med.held', opts);
  }

  resume(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'resume', 'med.resumed', opts);
  }

  complete(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'complete', 'med.completed', opts);
  }

  cancel(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'cancel', 'med.cancelled', opts);
  }

  async administer(
    id: string,
    input: { doseGiven: string; outcome: AdminOutcome; reason: string; correlationId?: string },
  ) {
    const current = await this.repo.findRequest(id);
    if (!current) {
      throw new NotFoundException({ code: 'MED_REQUEST_NOT_FOUND', message: 'Medication request not found' });
    }
    if (current.status !== 'dispensed') {
      throw new UnprocessableEntityException({
        code: 'MED_TRANSITION',
        message: `Administration requires dispensed status (now ${current.status})`,
      });
    }
    if (input.outcome !== 'given' && !input.reason) {
      throw new BadRequestException({
        code: 'ADMIN_REASON_REQUIRED',
        message: 'Not-given/held administrations require a reason',
      });
    }
    const admin = await this.repo.administer(id, input);
    await this.outbox.publish({
      aggregateType: 'med_request',
      aggregateId: id,
      type: 'med.administered',
      producer: 'medication',
      correlationId: input.correlationId,
      payload: { id, outcome: input.outcome },
    });
    return admin;
  }
}
