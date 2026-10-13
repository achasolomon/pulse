/** Theatre domain (R6 slice, CLIN-001 theatre paths, SAFE-001 checklist discipline). */

export type BookingStatus = 'booked' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled';
export type ChecklistStage = 'sign-in' | 'time-out' | 'sign-out';

const STAGE_ORDER: ChecklistStage[] = ['sign-in', 'time-out', 'sign-out'];

/** Pure booking machine. Throws Error('THEATRE_TRANSITION:...') on illegal moves. */
export function transitionBooking(
  from: BookingStatus,
  action: 'check-in' | 'start' | 'complete' | 'cancel',
): BookingStatus {
  const next: Record<string, BookingStatus> = {
    'booked:check-in': 'checked-in',
    'booked:cancel': 'cancelled',
    'checked-in:start': 'in-progress',
    'checked-in:cancel': 'cancelled',
    'in-progress:complete': 'completed',
    'in-progress:cancel': 'cancelled',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`THEATRE_TRANSITION:${from}->${action}`);
  return to;
}

/**
 * Pure checklist rule: stages complete strictly in order and exactly once.
 * Returns the next expected stage, or throws Error('CHECKLIST_*').
 */
export function nextChecklistStage(done: ChecklistStage[]): ChecklistStage | undefined {
  const seen = new Set(done);
  if (seen.size !== done.length) throw new Error('CHECKLIST_DUPLICATE');
  for (const stage of STAGE_ORDER) {
    if (!seen.has(stage)) return stage;
  }
  return undefined;
}

export function assertChecklistStage(done: ChecklistStage[], stage: ChecklistStage): void {
  const next = nextChecklistStage(done);
  if (next !== stage) throw new Error(`CHECKLIST_ORDER:expected ${next ?? 'complete'}, got ${stage}`);
}

export const THEATRE_REPOSITORY = 'THEATRE_REPOSITORY';

export interface TheatreRepository {
  defineSuite(facilityId: string, name: string, code: string): Promise<{ id: string }>;
  book(input: {
    encounterId: string;
    suiteId: string;
    procedureName: string;
    urgency: string;
    scheduledAt: string;
  }): Promise<{ id: string; status: BookingStatus }>;
  findBooking(id: string): Promise<{ id: string; status: BookingStatus } | undefined>;
  setBookingStatus(id: string, status: BookingStatus, cancelReason?: string): Promise<void>;
  completedStages(bookingId: string): Promise<ChecklistStage[]>;
  completeStage(bookingId: string, stage: ChecklistStage, items: unknown[], completedBy?: string): Promise<void>;
  saveRecord(bookingId: string, input: {
    surgeon: string;
    anesthetist: string;
    notes: string;
    startedAt?: string;
    endedAt?: string;
  }): Promise<{ id: string }>;
}
