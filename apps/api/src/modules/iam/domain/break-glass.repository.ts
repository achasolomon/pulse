export const BREAK_GLASS_REPOSITORY = 'BREAK_GLASS_REPOSITORY';

export interface BreakGlassGrant {
  id: string;
  expiresAt: Date;
}

/**
 * Break-glass grant persistence (IAM-001 §31): reasoned, time-limited,
 * scoped, reviewable. Expiry is passive via expires_at; expireDue() marks
 * lapsed grants and returns them so the service can emit BreakGlassExpired.
 */
export interface BreakGlassRepository {
  create(input: {
    personId: string;
    facilityId: string;
    patientId?: string;
    resourceType: string;
    action: string;
    reason: string;
    expiresAt: Date;
  }): Promise<BreakGlassGrant>;
  countRecent(personId: string, since: Date): Promise<number>;
  findActive(input: {
    personId: string;
    facilityId: string;
    patientId?: string;
    now: Date;
  }): Promise<BreakGlassGrant | undefined>;
  expireDue(now: Date): Promise<{ id: string; personId: string }[]>;
}
