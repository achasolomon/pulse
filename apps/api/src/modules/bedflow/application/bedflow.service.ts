import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  ENCOUNTER_REPOSITORY,
  type EncounterRepository,
} from '../../encounter/domain/encounter.repository.js';
import {
  BEDFLOW_REPOSITORY,
  bedAcceptsLevel,
  effectiveLevel,
  isBedAvailable,
  type Bed,
  type BedflowRepository,
  type CareLevel,
} from '../domain/bedflow.repository.js';

const REASON_MIN = 5;

/**
 * ICU/HDU bed-flow service (CLIN-001 section 13). Occupancy truth is the
 * active assignment — reservation alone is never admission. The ICU/HDU
 * workflow gate: an icu bed requires the encounter's current level of care to
 * be icu; hdu beds accept hdu or icu. Assistive guardrails, not policy engines.
 */
@Injectable()
export class BedflowService {
  constructor(
    @Inject(BEDFLOW_REPOSITORY) private readonly repo: BedflowRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters: EncounterRepository,
    private readonly outbox: OutboxService,
  ) {}

  async configureBed(
    locationId: string,
    input: { levelOfCare: CareLevel; isolationCapable?: boolean; correlationId?: string },
  ) {
    const bed = await this.requireBedLocation(locationId);
    await this.repo.configureBed(locationId, {
      levelOfCare: input.levelOfCare,
      isolationCapable: input.isolationCapable ?? false,
    });
    await this.outbox.publish({
      aggregateType: 'bedflow_bed',
      aggregateId: locationId,
      type: 'flow.bed_configured',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: { id: locationId, levelOfCare: input.levelOfCare, name: bed.name },
    });
    return (await this.repo.getLocation(locationId))!;
  }

  async setOutOfService(
    locationId: string,
    input: { reason: string; correlationId?: string },
  ) {
    const bed = await this.requireBedLocation(locationId);
    const reason = input.reason.trim();
    if (reason.length < REASON_MIN) {
      throw new UnprocessableEntityException({
        code: 'OOS_REASON_REQUIRED',
        message: 'Out-of-service requires a reason (min 5 chars)',
      });
    }
    const active = await this.repo.getActiveAssignmentByBed(locationId);
    if (active) {
      throw new ConflictException({
        code: 'BED_OCCUPIED',
        message: 'Cannot take an occupied bed out of service',
      });
    }
    await this.repo.setOutOfService(locationId, { outOfService: true, reason });
    await this.outbox.publish({
      aggregateType: 'bedflow_bed',
      aggregateId: locationId,
      type: 'flow.bed_out_of_service',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: { id: locationId, reason, name: bed.name },
    });
    return (await this.repo.getLocation(locationId))!;
  }

  async returnToService(locationId: string, opts: { correlationId?: string } = {}) {
    await this.requireBedLocation(locationId);
    await this.repo.setOutOfService(locationId, { outOfService: false });
    await this.outbox.publish({
      aggregateType: 'bedflow_bed',
      aggregateId: locationId,
      type: 'flow.bed_in_service',
      producer: 'bedflow',
      correlationId: opts.correlationId,
      payload: { id: locationId },
    });
    return (await this.repo.getLocation(locationId))!;
  }

  async listAvailableBeds(facilityId: string, filter: { level?: CareLevel; isolation?: boolean } = {}) {
    const beds = await this.repo.listBeds({
      facilityId,
      ...(filter.level ? { level: filter.level } : {}),
    });
    const out: (Bed & { available: boolean })[] = [];
    for (const bed of beds) {
      const active = await this.repo.getActiveAssignmentByBed(bed.id);
      const available = isBedAvailable({
        outOfService: bed.outOfService,
        activeAssignment: active,
      });
      if (!available) continue;
      if (filter.isolation && !bed.isolationCapable) continue;
      out.push({ ...bed, available });
    }
    return out;
  }

  listBeds(facilityId: string, filter: { level?: CareLevel } = {}) {
    return this.repo.listBeds({
      facilityId,
      ...(filter.level ? { level: filter.level } : {}),
    });
  }

  async assignBed(input: {
    encounterId: string;
    locationId: string;
    correlationId?: string;
  }) {
    const encounter = await this.encounters.findById(input.encounterId);
    if (!encounter || (encounter.status !== 'open' && encounter.status !== 'admitted')) {
      throw new ConflictException({
        code: 'ENCOUNTER_NOT_ACTIVE',
        message: 'Bed assignment requires an open or admitted encounter',
      });
    }
    const bed = await this.requireBedLocation(input.locationId);
    const own = await this.repo.getActiveAssignmentByEncounter(input.encounterId);
    if (own) {
      throw new ConflictException({
        code: 'ENCOUNTER_ALREADY_IN_BED',
        message: 'Encounter already has an active bed; use transfer',
      });
    }
    await this.assertAssignable(bed, input.encounterId, encounter.facilityId);
    const assignment = await this.repo.createAssignment({
      locationId: input.locationId,
      encounterId: input.encounterId,
      facilityId: encounter.facilityId,
    });
    await this.outbox.publish({
      aggregateType: 'bedflow_assignment',
      aggregateId: assignment.id,
      type: 'flow.bed_assigned',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: {
        id: assignment.id,
        locationId: bed.id,
        encounterId: input.encounterId,
        levelOfCare: bed.levelOfCare,
      },
    });
    return assignment;
  }

  async releaseBed(input: { encounterId: string; correlationId?: string }) {
    const active = await this.repo.getActiveAssignmentByEncounter(input.encounterId);
    if (!active) {
      throw new ConflictException({
        code: 'NO_ACTIVE_ASSIGNMENT',
        message: 'Encounter has no active bed assignment',
      });
    }
    await this.repo.endAssignment(active.id, new Date());
    await this.outbox.publish({
      aggregateType: 'bedflow_assignment',
      aggregateId: active.id,
      type: 'flow.bed_released',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: { id: active.id, locationId: active.locationId, encounterId: active.encounterId },
    });
    return (await this.repo.getAssignment(active.id))!;
  }

  async transferBed(input: {
    encounterId: string;
    locationId: string;
    correlationId?: string;
  }) {
    const active = await this.repo.getActiveAssignmentByEncounter(input.encounterId);
    if (!active) {
      throw new ConflictException({
        code: 'NO_ACTIVE_ASSIGNMENT',
        message: 'Transfer requires an active bed assignment',
      });
    }
    const encounter = await this.encounters.findById(input.encounterId);
    if (!encounter || (encounter.status !== 'open' && encounter.status !== 'admitted')) {
      throw new ConflictException({
        code: 'ENCOUNTER_NOT_ACTIVE',
        message: 'Bed transfer requires an open or admitted encounter',
      });
    }
    const bed = await this.requireBedLocation(input.locationId);
    await this.assertAssignable(bed, input.encounterId, encounter.facilityId);

    await this.repo.endAssignment(active.id, new Date());
    const assignment = await this.repo.createAssignment({
      locationId: input.locationId,
      encounterId: input.encounterId,
      facilityId: encounter.facilityId,
    });
    await this.outbox.publish({
      aggregateType: 'bedflow_assignment',
      aggregateId: assignment.id,
      type: 'flow.bed_transferred',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: {
        id: assignment.id,
        fromLocationId: active.locationId,
        locationId: bed.id,
        encounterId: input.encounterId,
      },
    });
    return assignment;
  }

  listAssignments(filter: { facilityId?: string; encounterId?: string; status?: 'active' | 'ended' }) {
    return this.repo.listAssignments(filter);
  }

  async setLevelOfCare(input: {
    encounterId: string;
    level: CareLevel;
    reason: string;
    correlationId?: string;
  }) {
    const encounter = await this.encounters.findById(input.encounterId);
    if (!encounter || (encounter.status !== 'open' && encounter.status !== 'admitted')) {
      throw new ConflictException({
        code: 'ENCOUNTER_NOT_ACTIVE',
        message: 'Level of care requires an open or admitted encounter',
      });
    }
    const reason = input.reason.trim();
    if (reason.length < REASON_MIN) {
      throw new UnprocessableEntityException({
        code: 'LEVEL_REASON_REQUIRED',
        message: 'Level of care change requires a reason (min 5 chars)',
      });
    }
    await this.repo.endActiveLevel(input.encounterId, new Date());
    const level = await this.repo.createLevel({
      encounterId: input.encounterId,
      level: input.level,
      reason,
    });
    await this.outbox.publish({
      aggregateType: 'bedflow_level',
      aggregateId: level.id,
      type: 'flow.level_of_care_set',
      producer: 'bedflow',
      correlationId: input.correlationId,
      payload: { id: level.id, encounterId: input.encounterId, level: input.level },
    });
    return level;
  }

  async getLevelOfCare(encounterId: string) {
    const [current, history] = await Promise.all([
      this.repo.getActiveLevel(encounterId),
      this.repo.listLevels(encounterId),
    ]);
    return { current, history, effective: effectiveLevel(current?.level) };
  }

  private async requireBedLocation(locationId: string): Promise<Bed> {
    const bed = await this.repo.getLocation(locationId);
    if (!bed) {
      throw new NotFoundException({ code: 'BED_NOT_FOUND', message: 'Unknown bed location' });
    }
    return bed;
  }

  private async assertAssignable(bed: Bed, encounterId: string, encounterFacilityId: string) {
    if (!bed.levelOfCare) {
      throw new UnprocessableEntityException({
        code: 'BED_LEVEL_UNSET',
        message: 'Bed has no level of care configured',
      });
    }
    if (bed.facilityId !== encounterFacilityId) {
      throw new UnprocessableEntityException({
        code: 'FACILITY_MISMATCH',
        message: 'Bed facility must match the encounter facility',
      });
    }
    const current = await this.repo.getActiveAssignmentByBed(bed.id);
    if (!isBedAvailable({ outOfService: bed.outOfService, activeAssignment: current })) {
      throw new ConflictException({
        code: 'BED_UNAVAILABLE',
        message: bed.outOfService ? 'Bed is out of service' : 'Bed is already occupied',
      });
    }
    const encounterLevel = effectiveLevel((await this.repo.getActiveLevel(encounterId))?.level);
    if (!bedAcceptsLevel(bed.levelOfCare, encounterLevel)) {
      throw new UnprocessableEntityException({
        code: 'LEVEL_OF_CARE_REQUIRED',
        message: `A ${bed.levelOfCare} bed requires the encounter's current level of care to be ${bed.levelOfCare === 'icu' ? 'icu' : 'hdu or icu'}`,
      });
    }
  }
}
