import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  StaffClinicalNote,
  StaffNoteDraftContent,
  StaffNoteSaveInput,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import {validateNoteFormatting} from '../domain/note-formatting.js';
import {validNoteDocument,noteDocumentText} from '@pulse/api-contracts/note-rich-text';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { StaffNoteRepository } from '../domain/staff-note.repository.js';
type Row = {
  rich_text: import('@pulse/api-contracts').NoteFormatting;
  encounter_type: string;
  encounter_status: string;
  encounter_started_at: Date;
  id: string;
  patient_id: string;
  encounter_id: string;
  author_id: string | null;
  note_type: StaffClinicalNote['kind'];
  status: 'draft' | 'signed';
  version: number;
  chief_complaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  created_at: Date;
  updated_at: Date;
  signed_at: Date | null;
};
@Injectable()
export class KyselyStaffNoteRepository implements StaffNoteRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  private require(scope: PatientReadScope, privilege: string) {
    if (!scope.privileges.includes(privilege))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'This note action is not available for your account',
      });
  }
  private care(
    scope: PatientReadScope,
    patientId: string,
    encounterId?: string,
  ) {
    return sql`EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=${patientId}::uuid AND a.facility_id=${scope.facilityId}::uuid AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()) ${encounterId ? sql`AND a.encounter_id=${encounterId}::uuid` : sql``})`;
  }
  async contexts(scope: PatientReadScope, patientId: string) {
    this.require(scope, 'note:write');
    const rows = (
      await sql<{
        id: string;
        type: string;
        started_at: Date;
        stage: string | null;
        nurse_person_id: string | null;
        clinician_person_id: string | null;
      }>`SELECT e.id,e.type,e.started_at,v.stage,v.nurse_person_id,v.clinician_person_id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id LEFT JOIN encounter.outpatient_visit v ON v.encounter_id=e.id AND v.facility_id=e.facility_id AND v.patient_id=e.patient_id
   WHERE e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid AND e.status IN ('open','admitted') AND p.status='active' AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=e.patient_id AND a.facility_id=e.facility_id AND a.encounter_id=e.id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now())) ORDER BY e.started_at DESC,e.id DESC LIMIT 100`.execute(
        this.db,
      )
    ).rows;
    return rows
      .map((r) => ({
        encounterId: r.id,
        type: r.type,
        startedAt: r.started_at.toISOString(),
        kinds: this.kinds(scope, r),
      }))
      .filter((r) => r.kinds.length);
  }
  private kinds(
    scope: PatientReadScope,
    row: {
      type: string;
      stage: string | null;
      nurse_person_id: string | null;
      clinician_person_id: string | null;
    },
  ): ('nursing' | 'consultation')[] {
    const kinds: ('nursing' | 'consultation')[] = [];
    if (
      scope.privileges.includes('note:nursing') &&
      (row.stage
        ? row.nurse_person_id === scope.personId
        : row.type !== 'outpatient')
    )
      kinds.push('nursing');
    if (
      scope.privileges.includes('encounter:consult') &&
      (row.stage
        ? row.stage === 'in-consultation' &&
          row.clinician_person_id === scope.personId
        : row.type !== 'outpatient')
    )
      kinds.push('consultation');
    return kinds;
  }
  async get(scope: PatientReadScope, id: string) {
    this.require(scope, 'note:read');
    const row = (
      await sql<Row>`SELECT n.*,e.type AS encounter_type,e.status AS encounter_status,e.started_at AS encounter_started_at FROM clin.note n JOIN patient.patient p ON p.id=n.patient_id JOIN encounter.encounter e ON e.id=n.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id
   WHERE n.id=${id}::uuid AND p.facility_id=${scope.facilityId}::uuid AND (n.status='signed' OR n.author_id=${scope.personId}::uuid) AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=n.patient_id AND a.facility_id=p.facility_id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))`.execute(
        this.db,
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: 'NOTE_NOT_FOUND',
        message: 'This note is unavailable for your account in this facility',
      });
    const addenda = (
      await sql<{
        id: string;
        text: string;
        author_id: string | null;
        author_login: string | null;
        created_at: Date;
      }>`SELECT a.id,a.text,a.author_id,a.created_at,(SELECT c.login_id FROM iam.credential c WHERE c.person_id=a.author_id ORDER BY c.created_at DESC LIMIT 1) AS author_login FROM clin.note_addendum a WHERE a.note_id=${id}::uuid ORDER BY a.created_at,a.id`.execute(
        this.db,
      )
    ).rows;
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','note.read','note',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(
      this.db,
    );
    return {
      id: row.id,
      patientId: row.patient_id,
      encounterId: row.encounter_id,
      authorId: row.author_id,
      kind: row.note_type,
      status: row.status,
      version: row.version,
      chiefComplaint: row.chief_complaint,
      history: row.history,
      examination: row.examination,
      assessment: row.assessment,
      plan: row.plan,
      ...(Object.keys(row.rich_text??{}).length?{richText:row.rich_text}:{}),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      signedAt: row.signed_at?.toISOString() ?? null,
      encounter: {
        type: row.encounter_type,
        status: row.encounter_status,
        startedAt: row.encounter_started_at.toISOString(),
      },
      addenda: addenda.map((a) => ({
        id: a.id,
        text: a.text,
        authorId: a.author_id,
        authorLogin: a.author_login,
        createdAt: a.created_at.toISOString(),
      })),
    };
  }
  private async context(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    patientId: string,
    encounterId: string,
    kind: string,
  ) {
    const row = (
      await sql<{
        type: string;
        stage: string | null;
        nurse_person_id: string | null;
        clinician_person_id: string | null;
      }>`SELECT e.type,v.stage,v.nurse_person_id,v.clinician_person_id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id LEFT JOIN encounter.outpatient_visit v ON v.encounter_id=e.id AND v.facility_id=e.facility_id AND v.patient_id=e.patient_id
   WHERE e.id=${encounterId}::uuid AND e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid AND e.status IN ('open','admitted') AND p.status='active' AND ${this.care(scope, patientId, encounterId)} FOR SHARE OF e,p`.execute(
        trx,
      )
    ).rows[0];
    // Lock encounter-specific care and ownership through the note write.
    const careRows =
      await sql`SELECT id FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=${patientId}::uuid AND a.facility_id=${scope.facilityId}::uuid AND a.encounter_id=${encounterId}::uuid AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()) FOR SHARE`.execute(
        trx,
      );
    const visitRows = await sql<{
      stage: string;
      nurse_person_id: string | null;
      clinician_person_id: string | null;
    }>`SELECT stage,nurse_person_id,clinician_person_id FROM encounter.outpatient_visit WHERE encounter_id=${encounterId}::uuid AND facility_id=${scope.facilityId}::uuid AND patient_id=${patientId}::uuid FOR SHARE`.execute(
      trx,
    );
    const stable = row ? { ...row, ...visitRows.rows[0] } : null;
    if (
      !stable ||
      !careRows.rows.length ||
      !this.kinds(scope, stable).includes(
        kind === 'nursing' ? 'nursing' : 'consultation',
      )
    )
      throw new ForbiddenException({
        code: 'NOTE_ENCOUNTER_NOT_ASSIGNED',
        message:
          'An active, assigned encounter is required for this note. Start your consultation or claim the nursing visit first.',
      });
  }
  async save(
    scope: PatientReadScope,
    patientId: string,
    input: StaffNoteSaveInput,
  ) {
    validateNoteFormatting(input);
    this.require(scope, 'note:write');
    this.require(scope, 'note:read');
    const receipt = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'note.drafted',
      { patientId, ...input },
      async (trx) => {
        await this.context(
          trx,
          scope,
          patientId,
          input.encounterId,
          input.kind,
        );
        const row = (
          await sql<{
            id: string;
          }>`INSERT INTO clin.note(patient_id,encounter_id,author_id,note_type,chief_complaint,history,examination,assessment,plan,rich_text)VALUES(${patientId}::uuid,${input.encounterId}::uuid,${scope.personId}::uuid,${input.kind},${input.chiefComplaint},${input.history},${input.examination},${input.assessment},${input.plan},${JSON.stringify(input.richText??{})}::jsonb)RETURNING id`.execute(
            trx,
          )
        ).rows[0]!;
        await commandEvidence(trx, scope, 'note', row.id, 'note.drafted', {
          patientId,
          encounterId: input.encounterId,
          noteType: input.kind,
          version: 1,
        });
        return { id: row.id };
      },
    );
    return this.get(scope, receipt.id);
  }
  private async owned(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    id: string,
  ) {
    const row = (
      await sql<Row>`SELECT n.* FROM clin.note n JOIN patient.patient p ON p.id=n.patient_id JOIN encounter.encounter e ON e.id=n.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id WHERE n.id=${id}::uuid AND p.facility_id=${scope.facilityId}::uuid AND n.author_id=${scope.personId}::uuid FOR UPDATE OF n`.execute(
        trx,
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: 'NOTE_NOT_FOUND',
        message: 'Only the author can change this note',
      });
    return row;
  }
  async update(
    scope: PatientReadScope,
    id: string,
    input: StaffNoteDraftContent & { commandKey: string; expectedVersion: number },
  ) {
    validateNoteFormatting(input);
    this.require(scope, 'note:write');
    this.require(scope, 'note:read');
    const receipt = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'note.updated',
      { id, ...input },
      async (trx) => {
        const current = await this.owned(trx, scope, id);
        if (current.status !== 'draft')
          throw new ConflictException({
            code: 'NOTE_SIGNED',
            message: 'Signed notes cannot be edited. Add an addendum instead.',
          });
        if (current.version !== input.expectedVersion)
          throw new ConflictException({
            code: 'NOTE_VERSION_CONFLICT',
            message:
              'This draft has changed. Your text has been kept; review the current version before saving again.',
          });
        await this.context(
          trx,
          scope,
          current.patient_id,
          current.encounter_id,
          current.note_type,
        );
        const formatting=input.richText??Object.fromEntries(Object.entries(current.rich_text??{}).filter(([field,document])=>['history','examination','assessment','plan'].includes(field)&&validNoteDocument(document)&&noteDocumentText(document)===input[field as 'history']));
        await sql`UPDATE clin.note SET chief_complaint=${input.chiefComplaint},history=${input.history},examination=${input.examination},assessment=${input.assessment},plan=${input.plan},rich_text=${JSON.stringify(formatting)}::jsonb,version=version+1,updated_at=now() WHERE id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(trx, scope, 'note', id, 'note.updated', {
          version: current.version + 1,
        });
        return { id };
      },
    );
    return this.get(scope, receipt.id);
  }
  async sign(
    scope: PatientReadScope,
    id: string,
    input: {
      commandKey: string;
      expectedVersion: number;
      attestation: boolean;
    },
  ) {
    this.require(scope, 'note:sign');
    this.require(scope, 'note:read');
    if (!input.attestation)
      throw new BadRequestException({
        message: 'Review the note before signing',
      });
    const receipt = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'note.signed',
      { id, ...input },
      async (trx) => {
        const current = await this.owned(trx, scope, id);
        if (
          current.status !== 'draft' ||
          current.version !== input.expectedVersion
        )
          throw new ConflictException({
            code: 'NOTE_VERSION_CONFLICT',
            message:
              'The note has changed or was already signed. Review its current version.',
          });
        await this.context(
          trx,
          scope,
          current.patient_id,
          current.encounter_id,
          current.note_type,
        );
        if (
          !current.chief_complaint.trim() ||
          ![
            current.history,
            current.examination,
            current.assessment,
            current.plan,
          ].some((v) => v.trim())
        )
          throw new BadRequestException({
            code: 'NOTE_CONTENT_REQUIRED',
            message:
              'Record a reason for the note and clinical content before signing',
          });
        await sql`UPDATE clin.note SET status='signed',signed_at=now(),updated_at=now(),version=version+1 WHERE id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(trx, scope, 'note', id, 'note.signed', {
          version: current.version + 1,
          encounterId: current.encounter_id,
        });
        return { id };
      },
    );
    return this.get(scope, receipt.id);
  }
  async amend(
    scope: PatientReadScope,
    id: string,
    input: { commandKey: string; text: string },
  ) {
    this.require(scope, 'note:amend');
    this.require(scope, 'note:read');
    const receipt = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'note.addendum',
      { id, ...input },
      async (trx) => {
        const current = await this.owned(trx, scope, id);
        if (current.status !== 'signed')
          throw new ConflictException({
            code: 'NOTE_NOT_SIGNED',
            message:
              'Edit the draft before signing; addenda apply to signed notes only',
          });
        const access = (
          await sql`SELECT id FROM patient.patient WHERE id=${current.patient_id}::uuid AND facility_id=${scope.facilityId}::uuid AND ${this.care(scope, current.patient_id)}`.execute(
            trx,
          )
        ).rows;
        if (!access.length)
          throw new ForbiddenException({
            code: 'CARE_ACCESS_REQUIRED',
            message:
              'An active care assignment is required to append an addendum',
          });
        const added = (
          await sql<{
            id: string;
          }>`INSERT INTO clin.note_addendum(note_id,text,author_id)VALUES(${id}::uuid,${input.text},${scope.personId}::uuid)RETURNING id`.execute(
            trx,
          )
        ).rows[0]!;
        await commandEvidence(trx, scope, 'note', id, 'note.addendum', {
          addendumId: added.id,
        });
        return { id };
      },
    );
    return this.get(scope, receipt.id);
  }
}
