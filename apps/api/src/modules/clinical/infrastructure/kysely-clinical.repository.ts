import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ClinicalNote,
  ClinicalRepository,
  Observation,
  ClinicalEntry,
  TimelineItem,
} from '../domain/clinical.repository.js';

@Injectable()
export class KyselyClinicalRepository implements ClinicalRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async recordObservation(input: Observation) {
    const r = await this.db
      .insertInto('clin.observation')
      .values({
        ...(input.id ? { id: input.id } : {}),
        patient_id: input.patientId,
        encounter_id: input.encounterId ?? null,
        code: input.code,
        value_num: input.valueNum ?? null,
        value_text: input.valueText ?? null,
        unit: input.unit ?? null,
        origin: input.origin ?? 'local',
        ...(input.takenAt ? { taken_at: new Date(input.takenAt) } : {}),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async createNote(input: {
    patientId: string;
    encounterId: string;
    authorId?: string;
    chiefComplaint: string;
    history: string;
    examination: string;
    assessment: string;
    plan: string;
  }): Promise<ClinicalNote> {
    const r = await this.db
      .insertInto('clin.note')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId,
        author_id: input.authorId ?? null,
        chief_complaint: input.chiefComplaint,
        history: input.history,
        examination: input.examination,
        assessment: input.assessment,
        plan: input.plan,
      })
      .returning(['id', 'patient_id', 'encounter_id', 'author_id', 'chief_complaint', 'history', 'examination', 'assessment', 'plan', 'status'])
      .executeTakeFirstOrThrow();
    return this.mapNote(r);
  }

  async signNote(id: string): Promise<ClinicalNote> {
    // Guard: only drafts sign, and only once (immutable after).
    const current = await this.db
      .selectFrom('clin.note')
      .select(['status'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    if (current.status !== 'draft') {
      throw new Error('NOTE_ALREADY_SIGNED');
    }
    const r = await this.db
      .updateTable('clin.note')
      .set({ status: 'signed', signed_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'draft')
      .returning(['id', 'patient_id', 'encounter_id', 'author_id', 'chief_complaint', 'history', 'examination', 'assessment', 'plan', 'status'])
      .executeTakeFirstOrThrow();
    return this.mapNote(r);
  }

  async addAddendum(noteId: string, text: string): Promise<void> {
    await this.db
      .insertInto('clin.note_addendum')
      .values({ note_id: noteId, text })
      .execute();
  }

  async recordEntry(input: ClinicalEntry) {
    const r = await this.db
      .insertInto('clin.entry')
      .values({
        ...(input.id ? { id: input.id } : {}),
        patient_id: input.patientId,
        encounter_id: input.encounterId ?? null,
        kind: input.kind,
        code: input.code ?? null,
        display: input.display,
        ...(input.status ? { status: input.status } : {}),
        origin: input.origin ?? 'local',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async listEntries(patientId: string, kind?: 'problem' | 'allergy' | 'diagnosis') {
    let q = this.db
      .selectFrom('clin.entry')
      .select(['kind', 'display', 'status'])
      .where('patient_id', '=', patientId)
      .where('status', '=', 'active');
    if (kind) q = q.where('kind', '=', kind);
    const rows = await q.orderBy('recorded_at', 'desc').limit(50).execute();
    return rows.map((r) => ({
      kind: r.kind as 'problem' | 'allergy' | 'diagnosis',
      display: r.display,
      status: r.status,
    }));
  }

  async timeline(patientId: string, limit: number): Promise<TimelineItem[]> {
    const [encounters, notes, obs, entries, appts] = await Promise.all([
      this.db
        .selectFrom('encounter.encounter')
        .select(['id', 'type', 'status', 'started_at'])
        .where('patient_id', '=', patientId)
        .orderBy('started_at', 'desc')
        .limit(limit)
        .execute(),
      this.db
        .selectFrom('clin.note')
        .select(['id', 'status', 'created_at'])
        .where('patient_id', '=', patientId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute(),
      this.db
        .selectFrom('clin.observation')
        .select(['code', 'taken_at'])
        .where('patient_id', '=', patientId)
        .orderBy('taken_at', 'desc')
        .limit(limit)
        .execute(),
      this.db
        .selectFrom('clin.entry')
        .select(['kind', 'display', 'recorded_at'])
        .where('patient_id', '=', patientId)
        .orderBy('recorded_at', 'desc')
        .limit(limit)
        .execute(),
      this.db
        .selectFrom('sched.appointment')
        .select(['id', 'status', 'scheduled_at'])
        .where('patient_id', '=', patientId)
        .orderBy('scheduled_at', 'desc')
        .limit(limit)
        .execute(),
    ]);
    const items: TimelineItem[] = [
      ...encounters.map((e) => ({
        at: e.started_at.toISOString(),
        kind: 'encounter' as const,
        summary: `${e.type} encounter ${e.status}`,
      })),
      ...notes.map((n) => ({
        at: n.created_at.toISOString(),
        kind: 'note' as const,
        summary: `Clinical note ${n.status}`,
      })),
      ...obs.map((o) => ({
        at: o.taken_at.toISOString(),
        kind: 'observation' as const,
        summary: `Observation ${o.code}`,
      })),
      ...entries.map((e) => ({
        at: e.recorded_at.toISOString(),
        kind: 'entry' as const,
        summary: `${e.kind}: ${e.display}`,
      })),
      ...appts.map((a) => ({
        at: a.scheduled_at.toISOString(),
        kind: 'appointment' as const,
        summary: `Appointment ${a.status}`,
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }

  private mapNote(r: {
    id: string;
    patient_id: string;
    encounter_id: string;
    author_id: string | null;
    chief_complaint: string;
    history: string;
    examination: string;
    assessment: string;
    plan: string;
    status: string;
  }): ClinicalNote {
    return {
      id: r.id,
      patientId: r.patient_id,
      encounterId: r.encounter_id,
      ...(r.author_id ? { authorId: r.author_id } : {}),
      chiefComplaint: r.chief_complaint,
      history: r.history,
      examination: r.examination,
      assessment: r.assessment,
      plan: r.plan,
      status: r.status as 'draft' | 'signed',
    };
  }
}
