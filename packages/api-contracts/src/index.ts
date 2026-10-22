export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Staff bootstrap is self-scoped and does not need a selected facility. */
export interface StaffFacilityContext {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  facilityCode: string;
  departmentId?: string;
  roles: string[];
  /** Presentation hints only; every command still enforces server policy. */
  privileges: string[];
}

export interface StaffContext {
  sessionId: string;
  personId: string;
  loginId: string;
  expiresAt: string;
  facilities: StaffFacilityContext[];
}

/** Browser-safe BFF session. No bearer token or encrypted cookie contents. */
export interface StaffWebSession {
  loginId: string;
  personId: string;
  expiresAt: number;
  facilities: StaffFacilityContext[];
  facility: StaffFacilityContext | null;
}

export interface StaffAccountSecurity {
  mfaEnabled: boolean;
  recoveryEmail: string | null;
  emailVerified: boolean;
}
export interface StaffNotification {
  id: string;
  taskId: string;
  category: 'task';
  priority: 'normal';
  title: string;
  createdAt: string;
  readAt: string | null;
}
export interface StaffInboxPage {
  items: StaffNotification[];
  unreadCount: number;
  nextCursor: string | null;
}
export interface StaffAssignedTask {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}
export interface StaffPatientIdentity {
  id: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O' | 'U';
  status: 'active' | 'retired-duplicate';
  mrn: string | null;
  facilityId: string;
  mergedInto?: string;
}
export interface StaffPatientPage {
  items: StaffPatientIdentity[];
  nextCursor: string | null;
}
export interface VitalAssessment {
  referenceRange?: string;
  referenceLabel?: string;
  status: 'urgent' | 'attention' | 'not-flagged' | 'not-assessed';
  label: string;
  reason: string;
  ruleId: string | null;
  ruleVersion: string;
  sourceUrl: string | null;
}
export interface PhysiologicalDerivative {
  code: string; label: string; value: number | null; unit: string;
  category: string; status: 'attention' | 'not-flagged' | 'not-assessed';
  formula: string; reason: string; sourceIds: string[]; measuredAt: string | null;
  sourceUrl: string; ruleVersion: string;
}
export interface StaffChartOverview {
  patient: StaffPatientIdentity;
  fetchedAt: string;
  observations: { access: 'available' | 'restricted'; derived?: PhysiologicalDerivative[]; items: { id: string; code: string; value: string | null; unit: string | null; takenAt: string; origin: string; encounterId?: string | null; assessment?: VitalAssessment }[] };
  entries: { access: 'available' | 'restricted'; allergySummary?: {status:AllergyReviewStatus|'allergies-recorded';count:number;highCriticality:boolean;substances:string[];reviewedAt:string|null}; items: { id: string; kind: 'allergy' | 'problem' | 'diagnosis'; display: string; status: string; verificationStatus?:'provisional'|'confirmed'|'differential'|null; recordedAt: string; origin: string }[] };
}
export interface PatientRegistrationInput {
  givenName: string; familyName: string; dateOfBirth: string; sex: 'M'|'F'|'O'|'U';
  phone?: string; address?: string; confirmDuplicate?: boolean; commandKey: string;
}
export type PatientRegistrationResult = { kind:'registered'; patientId:string; mrn:string } | { kind:'duplicate-review'; candidates:StaffPatientIdentity[] };
export type OutpatientStage = 'waiting-vitals'|'vitals-in-progress'|'vitals-recorded'|'waiting-consultation'|'in-consultation'|'completed'|'cancelled';
export interface OutpatientVisit {
  id:string; encounterId:string; patient:StaffPatientIdentity; stage:OutpatientStage;
  checkedInAt:string; updatedAt:string; nursePersonId:string|null; clinicianPersonId:string|null;
}
export interface ConsultationStaff { personId:string; loginId:string }
export interface VitalMeasurement { code:'heart-rate'|'respiratory-rate'|'temperature'|'spo2'|'bp-systolic'|'bp-diastolic'|'weight'|'height'; value:number }
export type StaffChartSection = 'visits' | 'vitals' | 'notes' | 'entries' | 'medications' | 'investigations' | 'documents' | 'profile';
export interface StaffChartHistoryItem {
  diagnostic?: {
    kind: 'laboratory' | 'imaging';
    results: { component: string; value: string; unit: string | null; flag: 'normal' | 'high' | 'low' | 'critical' | null; version: number; recordedAt: string }[];
    report: { text: string; version: number } | null;
    verifiedAt: string | null;
  } | null;
  id: string; title: string; status: string; occurredAt: string; encounterId: string | null;
  encounter?: { type: string; startedAt: string } | null;
  note?: {authorId:string|null;kind:'clinical'|'consultation'|'nursing';version:number;richText?:import('./note-rich-text.mjs').NoteFormatting} | null;
  fields: { label: string; value: string | null }[];
}
export interface StaffChartHistoryPage { items: StaffChartHistoryItem[]; nextCursor: string | null; }
export {validNoteDocument,noteDocumentText,plainNoteDocument,appendNoteDocument} from './note-rich-text.mjs';
export type {NoteDocument,NoteNode,NoteFormatting} from './note-rich-text.mjs';
export interface StaffNoteContent { chiefComplaint:string; history:string; examination:string; assessment:string; plan:string; }
export type StaffNoteDraftContent = StaffNoteContent & {richText?: import('./note-rich-text.mjs').NoteFormatting};
export interface StaffClinicalNote extends StaffNoteContent {
 richText?:import('./note-rich-text.mjs').NoteFormatting;
 id:string; patientId:string; encounterId:string; authorId:string|null; kind:'clinical'|'consultation'|'nursing';
 status:'draft'|'signed'; version:number; createdAt:string; updatedAt:string; signedAt:string|null;
 encounter?:{type:string;status:string;startedAt:string};
 addenda:{id:string;text:string;authorId:string|null;authorLogin:string|null;createdAt:string}[];
}
export interface StaffNoteContext {encounterId:string;type:string;startedAt:string;kinds:('consultation'|'nursing')[];}
export interface StaffNoteSaveInput extends StaffNoteContent {richText?:import('./note-rich-text.mjs').NoteFormatting;commandKey:string;encounterId:string;kind:'consultation'|'nursing';}
/** Authored, uncoded problems/diagnoses; allergy reconciliation uses a separate workflow. */
export interface StaffProblemContext {encounterId:string;type:string;startedAt:string}
export interface StaffProblemInput {encounterId:string;kind:'problem'|'diagnosis';display:string;verificationStatus:'provisional'|'confirmed'|'differential';commandKey:string}
export interface StaffProblemResolution {encounterId:string;expectedVersion:number;reason:string;commandKey:string}
export interface StaffProblemEntry {
  id:string;patientId:string;encounterId:string|null;kind:'problem'|'diagnosis';display:string;code:string|null;origin:string;
  status:'active'|'resolved';verificationStatus:'provisional'|'confirmed'|'differential'|null;version:number;recordedAt:string;recordedBy:string|null;
  resolvedAt:string|null;resolvedBy:string|null;resolutionReason:string|null;resolutionEncounterId:string|null;
}
export type AllergyReviewStatus='unknown'|'no-known-allergies'|'no-known-drug-allergies';
export type AllergyInformationSource='patient'|'carer'|'clinical-record'|'clinician';
export interface StaffAllergy {
  id:string;substance:string;status:'active'|'resolved';origin:string;version:number;encounterId:string|null;
  verificationStatus:string|null;recordedAt:string;recordedBy:string|null;recordedByLabel?:string|null;correctedByLabel?:string|null;
  category:'medication'|'food'|'environment'|'other'|'unknown'|null;
  type:'allergy'|'intolerance'|'unknown'|null;reaction:string|null;severity:'mild'|'moderate'|'severe'|'unknown'|null;
  criticality:'low'|'high'|'unable-to-assess'|null;informationSource:AllergyInformationSource|null;
  correctionReason:string|null;correctedAt:string|null;correctedBy:string|null;
}
export interface StaffAllergyReview {id:string;status:AllergyReviewStatus;informationSource:AllergyInformationSource;reason:string;reviewedBy:string;reviewedByLabel?:string|null;reviewedAt:string;encounterId:string}
export interface StaffAllergyRecord {items:StaffAllergy[];latestReview:StaffAllergyReview|null;revision:string;contexts:StaffProblemContext[];reviewStatus:AllergyReviewStatus|'allergies-recorded'}
export interface StaffAllergyInput {
  encounterId:string;commandKey:string;expectedRevision:string;substance:string;category:NonNullable<StaffAllergy['category']>;
  type:NonNullable<StaffAllergy['type']>;reaction:string;severity:NonNullable<StaffAllergy['severity']>;criticality:NonNullable<StaffAllergy['criticality']>;
  informationSource:AllergyInformationSource;verificationStatus:'provisional'|'confirmed';
}
export interface StaffAllergyReviewInput {encounterId:string;commandKey:string;expectedRevision:string;status:AllergyReviewStatus;informationSource:AllergyInformationSource;reason:string;attestation:true}
export interface StaffAllergyCorrectionInput {encounterId:string;commandKey:string;expectedRevision:string;reason:string}
export interface StaffLabTest {id:string;code:string;name:string;specimenRequirement:string;version:number}
export interface StaffLabOrder {
  encounter:{type:string;startedAt:string};cancelledByLabel?:string|null;
  id:string;patientId:string;encounterId:string;test:StaffLabTest;urgency:'routine'|'urgent'|'stat';indication:string;
  status:'ordered'|'collected'|'accessioned'|'resulted'|'verified'|'cancelled';version:number;
  orderedBy:string|null;orderedByLabel:string|null;orderedAt:string;cancelReason:string|null;cancelledBy:string|null;cancelledAt:string|null;
}
export interface StaffLabOrderInput {encounterId:string;testId:string;testVersion:number;urgency:StaffLabOrder['urgency'];indication:string;commandKey:string;attestation:true}
export interface StaffLabCancellation {expectedVersion:number;reason:string;commandKey:string}
export interface StaffImagingProcedure {id:string;code:string;name:string;version:number;modality:string;bodyRegion:string;lateralityPolicy:'required'|'optional'|'na';instructions:string}
export interface StaffImagingOrder {
  id:string;patientId:string;encounterId:string;encounter:{type:string;startedAt:string};procedure:StaffImagingProcedure|null;
  procedureCode:string;bodyRegion:string;laterality:'left'|'right'|'bilateral'|'na'|null;
  urgency:'routine'|'urgent'|'stat';indication:string;safetyContext:string;
  status:'ordered'|'scheduled'|'protocolled'|'acquired'|'reported'|'final'|'cancelled';version:number;
  orderedBy:string|null;orderedByLabel:string|null;orderedAt:string;cancelReason:string|null;cancelledBy:string|null;cancelledByLabel:string|null;cancelledAt:string|null;
}
export interface StaffImagingOrderInput {encounterId:string;procedureId:string;procedureVersion:number;laterality:'left'|'right'|'bilateral'|'na';urgency:StaffImagingOrder['urgency'];indication:string;safetyContext:string;attestation:true;commandKey:string}
export interface StaffLabSpecimen {
  id:string;container:string;label:string;collectedAt:string;collectedBy:string|null;collectedByLabel:string|null;identityConfirmed:boolean|null;
  accession:{number:string;receivedAt:string;receivedBy:string;receivedByLabel:string|null}|null;
}
export interface StaffLabDutyOrder extends StaffLabOrder {
  patient:{id:string;givenName:string;familyName:string;mrn:string|null;dateOfBirth:string;sex:string|null;status:string};
  encounterStatus:string;specimens:StaffLabSpecimen[];
  results?:StaffLabResult[];
  verification?:{by:string|null;byLabel:string|null;at:string|null};
}
export interface StaffLabResult {
  id:string;component:string;value:string;unit:string|null;flag:'normal'|'high'|'low'|'critical'|null;
  version:number;recordedAt:string;effectiveAt:string|null;recordedBy:string|null;recordedByLabel:string|null;source:string|null;
}
export interface StaffLabResultInput {
  expectedVersion:number;commandKey:string;component:string;value:string;unit:string;
  flag:StaffLabResult['flag'];effectiveAt:string;attestation:true;
}
export interface StaffLabVerification {expectedVersion:number;commandKey:string;attestation:true}
export interface StaffCriticalCase {
  orderId:string;version:number;orderVersion:number;recipientId:string;recipientLabel:string|null;
  confirmedBy:string;confirmedByLabel:string|null;createdAt:string;dueAt:string;acknowledgedBy:string|null;acknowledgedAt:string|null;
  patient:{id:string;name:string;mrn:string|null};testName:string;status:string;coveringLabels:string[];
}
export interface StaffCriticalDetail {
  case:StaffCriticalCase|null;
  canAcknowledge:boolean;
  readBackConfirmed:boolean;
  results:StaffLabResult[];
  backups:{id:string;recipientId:string;recipientLabel:string|null;configuredByLabel:string|null;reason:string;mode:'immediate'|'at-deadline';status:'scheduled'|'active'|'blocked'|'cancelled';createdAt:string;activatedAt:string|null;decidedAt:string|null;decision:string|null}[];
  contacts:{id:string;actorId:string;actorLabel:string|null;recipientId:string;recipientLabel:string|null;channel:'phone'|'in-person';outcome:'reached'|'unreachable';readBack:boolean;occurredAt:string}[];
}
export interface StaffCriticalNotify {expectedVersion:number;recipientId:string;dueAt:string;commandKey:string;attestation:true}
export interface StaffCriticalAttempt {expectedVersion:number;recipientId?:string;channel:'phone'|'in-person';outcome:'reached'|'unreachable';readBack:boolean;occurredAt:string;commandKey:string}
export interface StaffCriticalBackup {expectedVersion:number;recipientId:string;mode:'immediate'|'at-deadline';reason:string;attestation:true;commandKey:string}
export interface StaffCriticalAck {expectedVersion:number;attestation:true;commandKey:string}
export interface StaffLabQueuePage {
  items:StaffLabDutyOrder[];nextCursor:string|null;
  counts:Record<'ordered'|'collected'|'accessioned'|'resulted',number>;oldestPendingAt:string|null;fetchedAt:string;
}
export interface StaffLabCollection {
  expectedVersion:number;container:string;label:string;collectedAt:string;identityConfirmed:true;commandKey:string;
}
export interface StaffLabAccession {
  expectedVersion:number;specimenId:string;accessionNumber:string;receivedAt:string;identityConfirmed:true;commandKey:string;
}
