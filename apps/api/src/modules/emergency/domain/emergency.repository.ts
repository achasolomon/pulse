/** Emergency domain (R6 slice, CLIN-001 emergency paths). Scoring assists; the clinician decides. */

export type AcuityLevel = 1 | 2 | 3 | 4 | 5;

export interface AcuityScore {
  encounterId: string;
  level: AcuityLevel;
  discriminator: string;
  recordedAt: string;
}

export interface WaitingEntry {
  encounterId: string;
  patientId: string;
  acuity?: AcuityLevel;
  arrivedAt: string;
  waitingMinutes: number;
  status: string;
}

/** Pure waiting-list ordering: acuity first (1 most urgent), then arrival. Unscored sorts last. */
export function orderWaitingList(
  entries: { encounterId: string; acuity?: number; arrivedAt: string }[],
  now: Date = new Date(),
): (typeof entries[number] & { waitingMinutes: number })[] {
  return entries
    .map((e) => ({
      ...e,
      waitingMinutes: Math.max(0, Math.round((now.getTime() - new Date(e.arrivedAt).getTime()) / 60000)),
    }))
    .sort((a, b) => {
      const aa = a.acuity ?? 6;
      const bb = b.acuity ?? 6;
      if (aa !== bb) return aa - bb;
      return new Date(a.arrivedAt).getTime() - new Date(b.arrivedAt).getTime();
    });
}

export const EMERGENCY_REPOSITORY = 'EMERGENCY_REPOSITORY';

export interface EmergencyRepository {
  recordAcuity(input: {
    encounterId: string;
    level: AcuityLevel;
    discriminator: string;
    overrideReason?: string;
    recordedBy?: string;
  }): Promise<{ id: string }>;
  latestAcuity(encounterId: string): Promise<AcuityScore | undefined>;
  waitingList(facilityId: string, limit: number): Promise<
    { encounterId: string; patientId: string; status: string; arrivedAt: string; acuity?: AcuityLevel }[]
  >;
}
