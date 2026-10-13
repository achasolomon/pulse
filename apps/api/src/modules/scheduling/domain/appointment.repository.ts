/** Scheduling domain (CLIN-001 section 5, EPIC-05). */

export type AppointmentStatus =
  | 'scheduled'
  | 'checked-in'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'no-show';

export interface Appointment {
  id: string;
  patientId: string;
  facilityId: string;
  departmentId?: string;
  scheduledAt: string;
  reason: string;
  status: AppointmentStatus;
}

/** Pure appointment machine. Throws Error('APPOINTMENT_TRANSITION:...') on illegal moves. */
export function transitionAppointment(
  from: AppointmentStatus,
  action: 'check-in' | 'start' | 'complete' | 'cancel' | 'no-show' | 'reschedule',
): AppointmentStatus {
  switch (action) {
    case 'check-in':
      if (from === 'scheduled') return 'checked-in';
      break;
    case 'start':
      if (from === 'checked-in') return 'in-progress';
      break;
    case 'complete':
      if (from === 'in-progress') return 'completed';
      break;
    case 'cancel':
      if (from === 'scheduled' || from === 'checked-in') return 'cancelled';
      break;
    case 'no-show':
      if (from === 'scheduled' || from === 'checked-in') return 'no-show';
      break;
    case 'reschedule':
      if (from === 'scheduled') return 'scheduled';
      break;
  }
  throw new Error(`APPOINTMENT_TRANSITION:${from}->${action}`);
}

export const APPOINTMENT_REPOSITORY = 'APPOINTMENT_REPOSITORY';

export interface AppointmentRepository {
  book(input: {
    patientId: string;
    facilityId: string;
    departmentId?: string;
    scheduledAt: string;
    reason: string;
  }): Promise<Appointment>;
  findById(id: string): Promise<Appointment | undefined>;
  setStatus(
    id: string,
    status: AppointmentStatus,
    scheduledAt?: string,
  ): Promise<Appointment>;
  queue(facilityId: string, limit: number): Promise<Appointment[]>;
  appointmentsFor(patientId: string, limit: number): Promise<Appointment[]>;
}
