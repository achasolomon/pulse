/** Referral exchange domain (REF-001 sections 5-9, EPIC-17, DB-001 sections 35-36). */

export type ReferralStatus =
  | 'draft'
  | 'submitted'
  | 'acknowledged'
  | 'info-requested'
  | 'accepted'
  | 'declined'
  | 'scheduled'
  | 'in-transit'
  | 'arrived'
  | 'closed'
  | 'cancelled'
  | 'expired';

/** Pure RTX machine. Throws Error('REFERRAL_TRANSITION:...') on illegal moves. */
export function transitionReferral(
  from: ReferralStatus,
  action:
    | 'submit'
    | 'acknowledge'
    | 'request-info'
    | 'resubmit'
    | 'accept'
    | 'decline'
    | 'schedule'
    | 'dispatch'
    | 'arrive'
    | 'close'
    | 'cancel'
    | 'expire'
    | 'redirect',
): ReferralStatus {
  const next: Record<string, ReferralStatus> = {
    'draft:submit': 'submitted',
    'draft:cancel': 'cancelled',
    'submitted:acknowledge': 'acknowledged',
    'submitted:cancel': 'cancelled',
    'submitted:expire': 'expired',
    'acknowledged:request-info': 'info-requested',
    'acknowledged:accept': 'accepted',
    'acknowledged:decline': 'declined',
    'info-requested:resubmit': 'submitted',
    'accepted:schedule': 'scheduled',
    'accepted:cancel': 'cancelled',
    'scheduled:dispatch': 'in-transit',
    'scheduled:cancel': 'cancelled',
    'in-transit:arrive': 'arrived',
    'arrived:close': 'closed',
    'declined:close': 'closed',
  };
  // redirect = new routing history; modelled as resubmit to a new destination at service level
  if (action === 'redirect' && (from === 'submitted' || from === 'acknowledged')) {
    return 'submitted';
  }
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`REFERRAL_TRANSITION:${from}->${action}`);
  return to;
}

export const REFERRAL_REPOSITORY = 'REFERRAL_REPOSITORY';

export interface ReferralRepository {
  create(input: {
    patientId: string;
    sendingFacilityId: string;
    receivingFacilityId?: string;
    type: string;
    urgency: string;
    clinicalQuestion: string;
  }): Promise<{ id: string; status: ReferralStatus }>;
  findCase(id: string): Promise<
    | {
        id: string;
        patientId: string;
        sendingFacilityId: string;
        receivingFacilityId?: string;
        status: ReferralStatus;
        packageVersion: number;
      }
    | undefined
  >;
  setStatus(
    id: string,
    status: ReferralStatus,
    extra?: { receivingFacilityId?: string; cancelReason?: string },
  ): Promise<void>;
  savePackage(caseId: string, payload: Record<string, unknown>): Promise<{ version: number }>;
  addMessage(caseId: string, authorId: string | undefined, body: string): Promise<{ id: string }>;
  messages(caseId: string): Promise<{ body: string }[]>;
  inbox(facilityId: string, limit: number): Promise<{ id: string; status: ReferralStatus }[]>;
  casesFor(patientId: string, limit: number): Promise<{ id: string; status: ReferralStatus }[]>;
}
