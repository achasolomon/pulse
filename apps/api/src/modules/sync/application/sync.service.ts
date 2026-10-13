import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PATIENT_REPOSITORY, scoreDuplicates, type PatientRepository } from '../../patient/domain/patient.repository.js';
import { PatientService } from '../../patient/application/patient.service.js';
import { ENCOUNTER_REPOSITORY, type EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import { EncounterService } from '../../encounter/application/encounter.service.js';
import { CLINICAL_REPOSITORY, type ClinicalRepository } from '../../clinical/domain/clinical.repository.js';
import { eventTypeAllowed } from '../domain/device.repository.js';
import {
  SYNC_REPOSITORY,
  decodeCursor,
  encodeCursor,
  type ConflictReason,
  type SyncEvent,
  type SyncRepository,
} from '../domain/sync.repository.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edge sync application service (EPIC-21 foundation).
 * Feed is a read over committed outbox facts. Apply reuses the same domain
 * services as online writes, so edge data meets identical validation:
 * anything ambiguous becomes a review conflict, never a silent overwrite
 * or a duplicate patient. Replay is safe via inbox dedupe.
 */
@Injectable()
export class SyncService {
  constructor(
    @Inject(SYNC_REPOSITORY) private readonly repo: SyncRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters: EncounterRepository,
    @Inject(CLINICAL_REPOSITORY) private readonly clinical: ClinicalRepository,
    private readonly patientService: PatientService,
    private readonly encounterService: EncounterService,
    private readonly outbox: OutboxService,
  ) {}

  async feed(
    cursorRaw: string,
    limit: number,
    consumerId: string,
    capabilities?: string[],
  ) {
    const since = cursorRaw ? decodeCursor(cursorRaw) : await this.repo.watermark(consumerId);
    const { events, cursor } = await this.repo.feed(since, limit, capabilities);
    await this.repo.saveWatermark(consumerId, cursor);
    return { events, cursor: encodeCursor(cursor) };
  }

  async apply(
    events: SyncEvent[],
    opts: { correlationId?: string; capabilities?: string[] },
  ) {
    // Device capability enforcement (EPIC-21 F21.1): validate the WHOLE
    // batch before any write — a single out-of-scope type rejects the batch
    // with no partial application.
    if (opts.capabilities) {
      const denied = [
        ...new Set(
          events.filter((e) => !eventTypeAllowed(opts.capabilities as string[], e.type)).map((e) => e.type),
        ),
      ];
      if (denied.length > 0) {
        throw new ForbiddenException({
          code: 'SYNC_CAPABILITY_DENIED',
          message: `Event types outside the device capability subset: ${denied.join(', ')}`,
        });
      }
    }
    const applied: string[] = [];
    const conflicts: string[] = [];
    const skipped: string[] = [];
    for (const event of events) {
      if (!UUID_RE.test(event.eventId)) {
        throw new Error(`SYNC_EVENT_ID_INVALID:${event.eventId}`);
      }
      if (await this.repo.isApplied(event.eventId)) {
        skipped.push(event.eventId);
        continue;
      }
      const outcome = await this.applyOne(event, opts.correlationId);
      await this.repo.markApplied(event.eventId);
      if (outcome === 'conflict') conflicts.push(event.eventId);
      else applied.push(event.eventId);
    }
    return { applied, conflicts, skipped };
  }

  private async applyOne(event: SyncEvent, correlationId?: string): Promise<'applied' | 'conflict'> {
    switch (event.type) {
      case 'patient.registered':
        return this.applyPatient(event, correlationId);
      case 'encounter.opened':
        return this.applyEncounter(event, correlationId);
      case 'observation.recorded':
        return this.applyObservation(event);
      default:
        return this.conflict(event, 'UNKNOWN_TYPE');
    }
  }

  private async applyPatient(event: SyncEvent, correlationId?: string): Promise<'applied' | 'conflict'> {
    const p = event.payload as Record<string, unknown>;
    const complete =
      typeof p['familyName'] === 'string' &&
      typeof p['givenName'] === 'string' &&
      typeof p['dateOfBirth'] === 'string' &&
      typeof p['sex'] === 'string' &&
      typeof p['facilityId'] === 'string';
    if (!complete) return this.conflict(event, 'UNKNOWN_TYPE');
    // Sync is stricter than online registration: ANY similarity signal
    // (even REVIEW-level) goes to human review, because the edge cannot
    // show the duplicate-warning dialog an online clerk would resolve.
    const existing = await this.patients
      .listFacilityPatients(p['facilityId'] as string, 200)
      .catch(() => []);
    const signals = scoreDuplicates(
      { familyName: p['familyName'] as string, dateOfBirth: p['dateOfBirth'] as string },
      existing,
      [],
    );
    if (signals.length > 0) return this.conflict(event, 'DUPLICATE_PATIENT');
    try {
      await this.patientService.register({
        familyName: p['familyName'] as string,
        givenName: p['givenName'] as string,
        dateOfBirth: p['dateOfBirth'] as string,
        sex: p['sex'] as 'M' | 'F' | 'O' | 'U',
        facilityId: p['facilityId'] as string,
        ...(typeof p['mrn'] === 'string' ? { mrn: p['mrn'] } : {}),
        correlationId,
      });
      return 'applied';
    } catch (err) {
      // Only genuine duplicates become review conflicts; anything else
      // (validation, unknown facility) fails the batch loudly for the operator.
      const code = (err as { response?: { code?: string } })?.response?.code;
      if (code === 'POSSIBLE_DUPLICATE') return this.conflict(event, 'DUPLICATE_PATIENT');
      throw err;
    }
  }

  private async applyEncounter(event: SyncEvent, correlationId?: string): Promise<'applied' | 'conflict'> {
    const p = event.payload as Record<string, unknown>;
    if (typeof p['patientId'] !== 'string' || typeof p['facilityId'] !== 'string') {
      return this.conflict(event, 'UNKNOWN_PATIENT');
    }
    try {
      await this.encounterService.open({
        patientId: p['patientId'],
        facilityId: p['facilityId'],
        type: p['type'] === 'inpatient' || p['type'] === 'emergency' ? p['type'] : 'outpatient',
        correlationId,
      });
      return 'applied';
    } catch {
      // Unknown/retired patient or facility mismatch: review, don't invent.
      return this.conflict(event, 'UNKNOWN_PATIENT');
    }
  }

  private async applyObservation(event: SyncEvent): Promise<'applied' | 'conflict'> {
    const o = event.payload as Record<string, unknown>;
    if (
      typeof o['patientId'] !== 'string' ||
      typeof o['code'] !== 'string' ||
      (typeof o['valueNum'] !== 'number' && typeof o['valueText'] !== 'string')
    ) {
      return this.conflict(event, 'UNKNOWN_TYPE');
    }
    // Append-only observations never conflict: replay is deduped by inbox,
    // distinct facts coexist.
    await this.clinical.recordObservation({
      patientId: o['patientId'],
      ...(typeof o['encounterId'] === 'string' ? { encounterId: o['encounterId'] } : {}),
      code: o['code'],
      ...(typeof o['valueNum'] === 'number' ? { valueNum: o['valueNum'] } : {}),
      ...(typeof o['valueText'] === 'string' ? { valueText: o['valueText'] } : {}),
      ...(typeof o['unit'] === 'string' ? { unit: o['unit'] } : {}),
    });
    return 'applied';
  }

  private async conflict(event: SyncEvent, reason: ConflictReason): Promise<'conflict'> {
    await this.repo.openConflict({
      eventId: event.eventId,
      eventType: event.type,
      aggregateId: event.aggregateId,
      reason,
    });
    return 'conflict';
  }

  async resolveConflict(id: string, resolution: string, opts: { correlationId?: string } = {}) {
    if (!resolution || resolution.trim().length < 3) {
            throw new BadRequestException({
        code: 'RESOLUTION_REQUIRED',
        message: 'Conflict resolution requires a note',
      });
    }
    await this.repo.resolveConflict(id, resolution);
    await this.outbox.publish({
      aggregateType: 'sync_conflict',
      aggregateId: id,
      type: 'sync.conflict_resolved',
      producer: 'sync',
      correlationId: opts.correlationId,
      payload: { id },
    });
    return { id, status: 'resolved' as const };
  }

  openConflicts() {
    return this.repo.findOpen();
  }
}
