import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import type { ClinicalRepository } from '../../clinical/domain/clinical.repository.js';
import { CLINICAL_REPOSITORY } from '../../clinical/domain/clinical.repository.js';
import type { EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import { ENCOUNTER_REPOSITORY } from '../../encounter/domain/encounter.repository.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import { PATIENT_REPOSITORY } from '../../patient/domain/patient.repository.js';
import {
  FhirWriteError,
  fingerprint,
  parseAllergyIntolerance,
  parseCondition,
  parseObservation,
  type ParsedAllergy,
  type ParsedCondition,
  type ParsedObservation,
} from '../domain/from-fhir.js';
import {
  Hl7v2Error,
  buildAck,
  parseOruR01,
  type ParsedObx,
  type ParsedOru,
} from '../domain/hl7v2.js';
import {
  toFhirAllergyIntolerance,
  toFhirCondition,
  toFhirObservation,
} from '../domain/translate.js';
import type { ExternalResourceRepository } from '../infrastructure/external-resource.repository.js';
import { EXTERNAL_RESOURCE_REPOSITORY } from '../infrastructure/external-resource.repository.js';
import type { PartnerRepository } from '../infrastructure/partner.repository.js';
import { PARTNER_REPOSITORY } from '../infrastructure/partner.repository.js';

export interface WriteResult {
  /** false = idempotent replay of a prior accepted write. */
  created: boolean;
  resource: Record<string, unknown>;
}

function operationOutcome(
  appCode: string,
  message: string,
  issueCode: string,
): {
  resourceType: 'OperationOutcome';
  code: string;
  message: string;
  issue: { severity: 'error'; code: string; diagnostics: string }[];
} {
  return {
    resourceType: 'OperationOutcome',
    code: appCode,
    message: `${appCode}: ${message}`,
    issue: [{ severity: 'error', code: issueCode, diagnostics: `${appCode}: ${message}` }],
  };
}

/**
 * External write pipeline (FHIR-001 sections 47, 50, 62-65):
 * validate payload -> resolve identity -> idempotency claim -> domain create
 * (origin='external', never promoted to locally signed) -> provenance +
 * access log + outbox event. Errors are OperationOutcome-shaped (section 54).
 */
@Injectable()
export class ExternalImportService {
  constructor(
    @Inject(EXTERNAL_RESOURCE_REPOSITORY) private readonly ledger: ExternalResourceRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters: EncounterRepository,
    @Inject(CLINICAL_REPOSITORY) private readonly clinical: ClinicalRepository,
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    private readonly outbox: OutboxService,
  ) {}

  async importCondition(input: {
    partnerId?: string;
    idempotencyKey?: string;
    resource: unknown;
  }): Promise<WriteResult> {
    const partnerId = this.requirePartner(input.partnerId);
    let parsed: ParsedCondition;
    try {
      parsed = parseCondition(input.resource);
    } catch (e) {
      this.toHttp(e);
    }
    const patientId = await this.requirePatientByRef(parsed.patientId);
    const encounterId = await this.requireEncounter(parsed.encounterId, patientId);
    return this.transact({
      partnerId,
      idempotencyKey: input.idempotencyKey,
      resourceType: 'Condition',
      method: 'fhir',
      fingerprint: fingerprint(input.resource),
      serialize: (id) => toFhirCondition({ ...parsed, id, patientId, encounterId, origin: 'external' }),
      create: async (id) => {
        const created = await this.clinical.recordEntry({
          id,
          patientId,
          encounterId,
          kind: 'problem',
          code: parsed.code,
          display: parsed.display,
          status: parsed.status,
          origin: 'external',
        });
        return toFhirCondition({ ...parsed, id: created.id, patientId, encounterId, origin: 'external' });
      },
    });
  }

  async importAllergyIntolerance(input: {
    partnerId?: string;
    idempotencyKey?: string;
    resource: unknown;
  }): Promise<WriteResult> {
    const partnerId = this.requirePartner(input.partnerId);
    let parsed: ParsedAllergy;
    try {
      parsed = parseAllergyIntolerance(input.resource);
    } catch (e) {
      this.toHttp(e);
    }
    const patientId = await this.requirePatientByRef(parsed.patientId);
    const encounterId = await this.requireEncounter(parsed.encounterId, patientId);
    return this.transact({
      partnerId,
      idempotencyKey: input.idempotencyKey,
      resourceType: 'AllergyIntolerance',
      method: 'fhir',
      fingerprint: fingerprint(input.resource),
      serialize: (id) =>
        toFhirAllergyIntolerance({ ...parsed, id, patientId, encounterId, origin: 'external' }),
      create: async (id) => {
        const created = await this.clinical.recordEntry({
          id,
          patientId,
          encounterId,
          kind: 'allergy',
          code: parsed.code,
          display: parsed.display,
          origin: 'external',
        });
        return toFhirAllergyIntolerance({
          ...parsed,
          id: created.id,
          patientId,
          encounterId,
          origin: 'external',
        });
      },
    });
  }

  async importObservation(input: {
    partnerId?: string;
    idempotencyKey?: string;
    resource: unknown;
  }): Promise<WriteResult> {
    const partnerId = this.requirePartner(input.partnerId);
    let parsed: ParsedObservation;
    try {
      parsed = parseObservation(input.resource);
    } catch (e) {
      this.toHttp(e);
    }
    const patientId = await this.requirePatientByRef(parsed.patientId);
    const encounterId = await this.requireEncounter(parsed.encounterId, patientId);
    const serialize = (id: string): Record<string, unknown> =>
      toFhirObservation(
        {
          code: parsed.code,
          ...(parsed.valueNum !== undefined ? { valueNum: parsed.valueNum } : {}),
          ...(parsed.valueText !== undefined ? { valueText: parsed.valueText } : {}),
          ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
          takenAt: parsed.takenAt,
          patientId,
          origin: 'external',
        },
        id,
      );
    return this.transact({
      partnerId,
      idempotencyKey: input.idempotencyKey,
      resourceType: 'Observation',
      method: 'fhir',
      fingerprint: fingerprint(input.resource),
      serialize,
      create: async (id) => {
        await this.clinical.recordObservation({
          id,
          patientId,
          encounterId,
          code: parsed.code,
          ...(parsed.valueNum !== undefined ? { valueNum: parsed.valueNum } : {}),
          ...(parsed.valueText !== undefined ? { valueText: parsed.valueText } : {}),
          ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
          takenAt: parsed.takenAt,
          origin: 'external',
        });
        return serialize(id);
      },
    });
  }

  /**
   * Legacy v2 adapter (section 65): one Observation per OBX, per-segment
   * idempotency key (message control id + set id), whole message validated
   * before any insert so ACK failures never imply partial acceptance.
   */
  async importHl7v2Oru(input: {
    partnerId?: string;
    message: string;
  }): Promise<WriteResult> {
    const partnerId = this.requirePartner(input.partnerId);
    let parsed: ParsedOru;
    try {
      parsed = parseOruR01(input.message);
    } catch (e) {
      this.toHttp(e);
    }
    const matches = await this.patients.findByIdentifierValue(parsed.patientMrn);
    if (matches.length === 0) {
      throw new NotFoundException(
        operationOutcome(
          'PATIENT_NOT_FOUND',
          `No patient with identifier '${parsed.patientMrn}'`,
          'not-found',
        ),
      );
    }
    if (matches.length > 1) {
      throw new ConflictException(
        operationOutcome(
          'PATIENT_IDENTITY_AMBIGUOUS',
          `Identifier '${parsed.patientMrn}' matches ${matches.length} patients; governed resolution required`,
          'conflict',
        ),
      );
    }
    const patientId = matches[0].id;

    const ids: string[] = [];
    let allCreated = true;
    for (const obx of parsed.observations) {
      const out = await this.importObx(partnerId, parsed.controlId, parsed.observedAt, patientId, obx);
      if (!out.created) allCreated = false;
      ids.push(String((out.resource as { id?: string }).id ?? ''));
    }
    return {
      created: allCreated,
      resource: {
        status: 'AA',
        control_id: parsed.controlId,
        ack: buildAck(parsed.controlId, 'AA'),
        observations: ids,
        replayed: !allCreated,
      },
    };
  }

  private async importObx(
    partnerId: string,
    controlId: string,
    observedAt: string | undefined,
    patientId: string,
    obx: ParsedObx,
  ): Promise<WriteResult> {
    const key = `hl7v2-oru:${controlId}:${obx.setId}`;
    const takenAt = observedAt ?? new Date().toISOString();
    const serialize = (id: string): Record<string, unknown> =>
      toFhirObservation(
        {
          code: obx.display ?? obx.identifier,
          ...(obx.valueNum !== undefined ? { valueNum: obx.valueNum } : { valueText: obx.value }),
          ...(obx.unit !== undefined ? { unit: obx.unit } : {}),
          takenAt,
          patientId,
          origin: 'external',
        },
        id,
      );
    return this.transact({
      partnerId,
      idempotencyKey: key,
      resourceType: 'Observation',
      method: 'hl7v2-oru',
      fingerprint: fingerprint({ controlId, obx }),
      serialize,
      create: async (id) => {
        await this.clinical.recordObservation({
          id,
          patientId,
          code: obx.display ?? obx.identifier,
          ...(obx.valueNum !== undefined ? { valueNum: obx.valueNum } : { valueText: obx.value }),
          ...(obx.unit !== undefined ? { unit: obx.unit } : {}),
          takenAt,
          origin: 'external',
        });
        return serialize(id);
      },
    });
  }

  /**
   * Claim-first idempotent create (section 50): ledger row wins the unique
   * key before the domain row; a domain failure compensates by removing the
   * claim. Concurrent winner -> replay (same fingerprint) or 409 conflict.
   */
  private async transact(opts: {
    partnerId: string;
    idempotencyKey?: string;
    resourceType: string;
    method: 'fhir' | 'hl7v2-oru';
    fingerprint: string;
    create: (id: string) => Promise<Record<string, unknown>>;
    serialize: (id: string) => Record<string, unknown>;
  }): Promise<WriteResult> {
    const { partnerId, resourceType, method } = opts;
    const key = opts.idempotencyKey?.trim() || undefined;
    try {
      if (key) {
        const prior = await this.ledger.findByIdempotencyKey(partnerId, resourceType, key);
        if (prior) return this.replayOrConflict(prior, opts, key);
      }
      const internalId = randomUUID();
      if (key) {
        try {
          await this.ledger.insert({
            partnerId,
            idempotencyKey: key,
            requestFingerprint: opts.fingerprint,
            resourceType,
            method,
            internalId,
          });
        } catch (e) {
          if (!isUnique(e)) throw e;
          const winner = await this.ledger.findByIdempotencyKey(partnerId, resourceType, key);
          if (!winner) throw e;
          return this.replayOrConflict(winner, opts, key);
        }
      } else {
        await this.ledger.insert({
          partnerId,
          idempotencyKey: null,
          requestFingerprint: opts.fingerprint,
          resourceType,
          method,
          internalId,
        });
      }

      let resource: Record<string, unknown>;
      try {
        resource = await opts.create(internalId);
      } catch (e) {
        if (key) await this.ledger.deleteByKey(partnerId, resourceType, key).catch(() => undefined);
        throw e;
      }
      await this.partners.logAccess({ partnerId, resourceType, resourceId: internalId, status: 201 });
      await this.outbox.publish({
        aggregateType: 'external_import',
        aggregateId: internalId,
        type: 'integration.external_imported',
        producer: 'fhir',
        payload: { resourceType, internalId, partnerId, method, origin: 'external' },
      });
      return { created: true, resource };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (typeof status === 'number' && status < 500) {
        await this.partners.logAccess({ partnerId, resourceType, status }).catch(() => undefined);
      }
      throw e;
    }
  }

  private replayOrConflict(
    prior: { internalId: string; requestFingerprint: string },
    opts: {
      partnerId: string;
      resourceType: string;
      fingerprint: string;
      serialize: (id: string) => Record<string, unknown>;
    },
    key: string,
  ): WriteResult {
    if (prior.requestFingerprint !== opts.fingerprint) {
      throw new ConflictException(
        operationOutcome(
          'IDEMPOTENCY_CONFLICT',
          `Idempotency key '${key}' was already used with a different payload`,
          'conflict',
        ),
      );
    }
    void this.partners
      .logAccess({
        partnerId: opts.partnerId,
        resourceType: opts.resourceType,
        resourceId: prior.internalId,
        status: 200,
      })
      .catch(() => undefined);
    return { created: false, resource: opts.serialize(prior.internalId) };
  }

  private requirePartner(partnerId: string | undefined): string {
    if (!partnerId) {
      throw new UnauthorizedException(
        operationOutcome('PARTNER_KEY_REQUIRED', 'x-api-key is required', 'invalid'),
      );
    }
    return partnerId;
  }

  private async requirePatientByRef(patientId: string): Promise<string> {
    const p = await this.patients.findById(patientId);
    if (!p) {
      throw new NotFoundException(
        operationOutcome('PATIENT_NOT_FOUND', `Patient/${patientId} not found`, 'not-found'),
      );
    }
    return p.id;
  }

  private async requireEncounter(
    encounterId: string | undefined,
    patientId: string,
  ): Promise<string | undefined> {
    if (!encounterId) return undefined;
    const enc = await this.encounters.findById(encounterId);
    if (!enc) {
      throw new NotFoundException(
        operationOutcome('ENCOUNTER_NOT_FOUND', `Encounter/${encounterId} not found`, 'not-found'),
      );
    }
    if (enc.patientId !== patientId) {
      throw new BadRequestException(
        operationOutcome(
          'ENCOUNTER_PATIENT_MISMATCH',
          'Encounter does not belong to the patient',
          'invalid',
        ),
      );
    }
    return enc.id;
  }

  private toHttp(e: unknown): never {
    if (e instanceof FhirWriteError) {
      throw new BadRequestException(operationOutcome(e.appCode, e.message, e.outcomeCode));
    }
    if (e instanceof Hl7v2Error) {
      throw new BadRequestException(operationOutcome(e.appCode, e.message, 'invalid'));
    }
    throw e;
  }
}

function isUnique(e: unknown): boolean {
  if ((e as { code?: string } | null)?.code === '23505') return true;
  return (e instanceof Error ? e.message : '').includes('duplicate key value');
}
