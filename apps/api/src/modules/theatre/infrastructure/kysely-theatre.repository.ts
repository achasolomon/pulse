import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  BookingStatus,
  ChecklistStage,
  TheatreRepository,
} from '../domain/theatre.repository.js';

@Injectable()
export class KyselyTheatreRepository implements TheatreRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async defineSuite(facilityId: string, name: string, code: string) {
    const r = await this.db
      .insertInto('theat.suite')
      .values({ facility_id: facilityId, name, code })
      .onConflict((oc) => oc.columns(['facility_id', 'code']).doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (r) return { id: r.id };
    const existing = await this.db
      .selectFrom('theat.suite')
      .select(['id'])
      .where('facility_id', '=', facilityId)
      .where('code', '=', code)
      .executeTakeFirstOrThrow();
    return { id: existing.id };
  }

  async book(input: {
    encounterId: string;
    suiteId: string;
    procedureName: string;
    urgency: string;
    scheduledAt: string;
  }) {
    const r = await this.db
      .insertInto('theat.booking')
      .values({
        encounter_id: input.encounterId,
        suite_id: input.suiteId,
        procedure_name: input.procedureName,
        urgency: input.urgency,
        scheduled_at: new Date(input.scheduledAt),
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as BookingStatus };
  }

  async findBooking(id: string) {
    const r = await this.db
      .selectFrom('theat.booking')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as BookingStatus } : undefined;
  }

  async setBookingStatus(id: string, status: BookingStatus, cancelReason?: string): Promise<void> {
    await this.db
      .updateTable('theat.booking')
      .set({ status, ...(cancelReason ? { cancel_reason: cancelReason } : {}) })
      .where('id', '=', id)
      .execute();
  }

  async completedStages(bookingId: string): Promise<ChecklistStage[]> {
    const rows = await this.db
      .selectFrom('theat.checklist')
      .select(['stage'])
      .where('booking_id', '=', bookingId)
      .execute();
    return rows.map((r) => r.stage as ChecklistStage);
  }

  async completeStage(
    bookingId: string,
    stage: ChecklistStage,
    items: unknown[],
    completedBy?: string,
  ): Promise<void> {
    await this.db
      .insertInto('theat.checklist')
      .values({
        booking_id: bookingId,
        stage,
        items: JSON.stringify(items),
        completed_by: completedBy ?? null,
      })
      .execute();
  }

  async saveRecord(
    bookingId: string,
    input: { surgeon: string; anesthetist: string; notes: string; startedAt?: string; endedAt?: string },
  ) {
    const r = await this.db
      .insertInto('theat.record')
      .values({
        booking_id: bookingId,
        surgeon: input.surgeon,
        anesthetist: input.anesthetist,
        notes: input.notes,
        started_at: input.startedAt ?? null,
        ended_at: input.endedAt ?? null,
      })
      .onConflict((oc) => oc.column('booking_id').doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (r) return { id: r.id };
    const existing = await this.db
      .selectFrom('theat.record')
      .select(['id'])
      .where('booking_id', '=', bookingId)
      .executeTakeFirstOrThrow();
    return { id: existing.id };
  }
}
