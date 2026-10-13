import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  CLINICAL_REPOSITORY,
  type ClinicalEntry,
  type ClinicalRepository,
  type Observation,
} from '../domain/clinical.repository.js';
import {
  ENCOUNTER_REPOSITORY,
  type EncounterRepository,
} from '../../encounter/domain/encounter.repository.js';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../../patient/domain/patient.repository.js';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../../workflow/domain/workflow.repository.js';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from '../../documents/domain/document.repository.js';

/** Clinical application service (EPIC-07/08). Signed notes immutable; corrections via addenda. */
@Injectable()
export class ClinicalService {
  constructor(
    @Inject(CLINICAL_REPOSITORY) private readonly repo: ClinicalRepository,
    private readonly outbox: OutboxService,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters?: EncounterRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients?: PatientRepository,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflow?: WorkflowRepository,
    @Inject(DOCUMENT_REPOSITORY) private readonly documents?: DocumentRepository,
  ) {}

  async recordVitals(input: { observations: Observation[]; correlationId?: string }) {
    for (const o of input.observations) {
      await this.repo.recordObservation(o);
    }
    return { recorded: input.observations.length };
  }

  async draftNote(input: {
    patientId: string;
    encounterId: string;
    authorId?: string;
    chiefComplaint: string;
    history: string;
    examination: string;
    assessment: string;
    plan: string;
    correlationId?: string;
  }) {
    const note = await this.repo.createNote(input);
    await this.outbox.publish({
      aggregateType: 'note',
      aggregateId: note.id,
      type: 'note.drafted',
      producer: 'clinical',
      correlationId: input.correlationId,
      payload: { id: note.id },
    });
    return note;
  }

  async signNote(id: string, opts: { correlationId?: string }) {
    try {
      const note = await this.repo.signNote(id);
      await this.outbox.publish({
        aggregateType: 'note',
        aggregateId: id,
        type: 'note.signed',
        producer: 'clinical',
        correlationId: opts.correlationId,
        payload: { id },
      });
      return note;
    } catch (err) {
      if (err instanceof Error && err.message === 'NOTE_ALREADY_SIGNED') {
        throw new ConflictException({
          code: 'NOTE_ALREADY_SIGNED',
          message: 'Signed notes are immutable — add an addendum instead',
        });
      }
      throw err;
    }
  }

  async addAddendum(noteId: string, text: string) {
    await this.repo.addAddendum(noteId, text);
    return { ok: true };
  }

  async recordEntry(input: ClinicalEntry & { correlationId?: string }) {
    const { correlationId, ...entry } = input;
    const created = await this.repo.recordEntry(entry);
    await this.outbox.publish({
      aggregateType: 'entry',
      aggregateId: created.id,
      type: 'entry.recorded',
      producer: 'clinical',
      correlationId,
      payload: { id: created.id, kind: entry.kind },
    });
    return created;
  }

  /**
   * Nursing handover baseline (F07.3): active encounters enriched with banner
   * data, active problems/allergies, and open tasks. Read-only composition.
   */
  async handover(facilityId: string) {
    if (!this.encounters || !this.patients || !this.workflow) {
      throw new Error('HANDOVER_DEPS_MISSING');
    }
    const active = await this.encounters.listActive(facilityId, 100);
    const items = [];
    for (const enc of active) {
      const [patient, problems, allergies, timeline] = await Promise.all([
        this.patients.findById(enc.patientId),
        this.repo.listEntries(enc.patientId, 'problem'),
        this.repo.listEntries(enc.patientId, 'allergy'),
        this.repo.timeline(enc.patientId, 5),
      ]);
      items.push({
        encounterId: enc.id,
        status: enc.status,
        departmentId: enc.departmentId,
        bed: enc.bed,
        patient: patient
          ? {
              id: patient.id,
              name: `${patient.givenName} ${patient.familyName}`,
              dateOfBirth: patient.dateOfBirth,
              identifiers: patient.identifiers,
            }
          : undefined,
        problems: problems.map((p) => p.display),
        allergies: allergies.map((a) => a.display),
        recent: timeline.slice(0, 5),
      });
    }
    const tasks = await this.workflow.openTasks(facilityId, 100);
    return { facilityId, census: items.length, items, openTasks: tasks };
  }

  /** Governed export bundle (F15.4): JSON first; audited + outbox at the endpoint. */
  async exportBundle(patientId: string) {
    if (!this.patients || !this.documents) {
      throw new Error('EXPORT_DEPS_MISSING');
    }
    const [patient, timeline, problems, allergies, documents] = await Promise.all([
      this.patients.findById(patientId),
      this.repo.timeline(patientId, 200),
      this.repo.listEntries(patientId, 'problem'),
      this.repo.listEntries(patientId, 'allergy'),
      this.documents.listForPatient(patientId, 50),
    ]);
    return { patient, timeline, problems, allergies, documents };
  }
}
