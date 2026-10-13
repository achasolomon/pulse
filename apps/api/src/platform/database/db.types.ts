import type { ColumnType, Generated } from 'kysely';

export interface OutboxRow {
  id: Generated<string>;
  aggregate_type: string;
  aggregate_id: string;
  type: string;
  version: number;
  occurred_at: ColumnType<Date, string | Date | undefined, never>;
  producer: string;
  correlation_id: string | null;
  payload: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
  published_at: Date | null;
}

export interface InboxRow {
  id: Generated<string>;
  event_id: string;
  consumer: string;
  received_at: Generated<Date>;
}

export interface AuditEventRow {
  id: Generated<string>;
  occurred_at: Generated<Date>;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  tenant_id: string | null;
  facility_id: string | null;
  correlation_id: string | null;
  metadata: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
}

export interface OrganizationRow {
  id: Generated<string>;
  name: string;
  code: string;
  created_at: Generated<Date>;
}

export interface FacilityRow {
  id: Generated<string>;
  organization_id: string;
  name: string;
  code: string;
  created_at: Generated<Date>;
}

export interface DepartmentRow {
  id: Generated<string>;
  facility_id: string;
  name: string;
  code: string;
  parent_department_id: string | null;
  created_at: Generated<Date>;
}

export interface UnitRow {
  id: Generated<string>;
  facility_id: string;
  name: string;
  code: string;
  created_at: Generated<Date>;
}

export interface LocationRow {
  id: Generated<string>;
  unit_id: string;
  facility_id: string;
  name: string;
  code: string;
  kind: string;
  level_of_care: string | null;
  isolation_capable: ColumnType<boolean, boolean | undefined, boolean>;
  out_of_service: ColumnType<boolean, boolean | undefined, boolean>;
  out_of_service_reason: string | null;
  created_at: Generated<Date>;
}

export interface MembershipRow {
  id: Generated<string>;
  person_id: string | null;
  account_name: string | null;
  organization_id: string;
  facility_id: string;
  roles: string[];
  privileges: string[];
  department_id: string | null;
  effective_from: Date | null;
  effective_to: Date | null;
  created_at: Generated<Date>;
}

export interface CareAssignmentRow {
  id: Generated<string>;
  patient_id: string;
  person_id: string;
  facility_id: string;
  kind: string;
  encounter_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
  created_at: Generated<Date>;
}

export interface BreakGlassGrantRow {
  id: Generated<string>;
  person_id: string;
  facility_id: string;
  patient_id: string | null;
  resource_type: string;
  action: string;
  reason: string;
  granted_at: Generated<Date>;
  expires_at: Date;
  revoked_at: Date | null;
  review_status: Generated<string>;
  created_at: Generated<Date>;
}

export interface PatientRow {
  id: Generated<string>;
  family_name: string;
  given_name: string;
  date_of_birth: ColumnType<Date, string | Date, never>;
  sex: string;
  facility_id: string;
  status: ColumnType<string, string | undefined, string>;
  guarantor_name: string | null;
  guarantor_contact: string | null;
  created_at: Generated<Date>;
}

export interface PatientIdentifierRow {
  id: Generated<string>;
  patient_id: string;
  system: string;
  value: string;
  facility_id: string | null;
  created_at: Generated<Date>;
}

export interface MergeLinkRow {
  id: Generated<string>;
  survivor_id: string;
  duplicate_id: string;
  reason: string;
  merged_by: string | null;
  created_at: Generated<Date>;
}

export interface EncounterRow {
  id: Generated<string>;
  patient_id: string;
  facility_id: string;
  type: string;
  status: ColumnType<string, string | undefined, string>;
  department_id: string | null;
  bed: string | null;
  disposition: string | null;
  coverage_id: string | null;
  started_at: Generated<Date>;
  ended_at: Date | null;
  created_at: Generated<Date>;
}

export interface EncounterTransferRow {
  id: Generated<string>;
  encounter_id: string;
  from_department_id: string | null;
  to_department_id: string | null;
  from_bed: string | null;
  to_bed: string | null;
  action: string;
  created_at: Generated<Date>;
}

export interface AppointmentRow {
  id: Generated<string>;
  patient_id: string;
  facility_id: string;
  department_id: string | null;
  scheduled_at: ColumnType<Date, string | Date, Date>;
  reason: string;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface ObservationRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string | null;
  code: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  origin: Generated<string>;
  taken_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface NoteRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string;
  author_id: string | null;
  chief_complaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  status: ColumnType<string, string | undefined, string>;
  signed_at: Date | null;
  created_at: Generated<Date>;
}

export interface NoteAddendumRow {
  id: Generated<string>;
  note_id: string;
  text: string;
  created_at: Generated<Date>;
}

export interface EntryRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string | null;
  kind: string;
  code: string | null;
  display: string;
  status: ColumnType<string, string | undefined, string>;
  origin: Generated<string>;
  recorded_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface LabTestRow {
  id: Generated<string>;
  code: string;
  name: string;
  specimen_requirement: string;
  version: number;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface LabOrderRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string;
  test_id: string;
  test_version: number;
  urgency: ColumnType<string, string | undefined, string>;
  indication: string;
  status: ColumnType<string, string | undefined, string>;
  cancel_reason: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  critical_ack_by: string | null;
  critical_ack_at: Date | null;
  created_at: Generated<Date>;
}

export interface LabSpecimenRow {
  id: Generated<string>;
  order_id: string;
  container: string;
  label: string;
  collected_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface LabResultRow {
  id: Generated<string>;
  order_id: string;
  component: string;
  value_text: string;
  unit: string | null;
  flag: string | null;
  version: number;
  created_at: Generated<Date>;
}

export interface ImagingOrderRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string;
  procedure_code: string;
  body_region: string;
  laterality: string | null;
  indication: string;
  urgency: ColumnType<string, string | undefined, string>;
  status: ColumnType<string, string | undefined, string>;
  cancel_reason: string | null;
  created_at: Generated<Date>;
}

export interface ImagingStudyRow {
  id: Generated<string>;
  order_id: string;
  study_uid: string;
  accession: string;
  modality: string;
  pacs_ref: string;
  created_at: Generated<Date>;
}

export interface ImagingReportRow {
  id: Generated<string>;
  order_id: string;
  text: string;
  status: ColumnType<string, string | undefined, string>;
  version: number;
  author_id: string | null;
  created_at: Generated<Date>;
}

export interface MedicationRow {
  id: Generated<string>;
  code: string;
  name: string;
  dose_form: string;
  strength: string;
  route: string;
  version: number;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface MedRequestRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string;
  medication_id: string;
  dose: string;
  dose_unit: string;
  route: string;
  frequency: string;
  status: ColumnType<string, string | undefined, string>;
  hold_reason: string | null;
  cancel_reason: string | null;
  created_at: Generated<Date>;
}

export interface MedDispenseRow {
  id: Generated<string>;
  request_id: string;
  quantity: string;
  batch: string;
  created_at: Generated<Date>;
}

export interface MedAdministrationRow {
  id: Generated<string>;
  request_id: string;
  dose_given: string;
  outcome: string;
  reason: string;
  given_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface InventoryItemRow {
  id: Generated<string>;
  code: string;
  name: string;
  base_unit: string;
  conversions: ColumnType<unknown, string, string>;
  requires_batch: ColumnType<boolean, boolean | undefined, boolean>;
  requires_expiry: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface InventoryLocationRow {
  id: Generated<string>;
  facility_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  created_at: Generated<Date>;
}

export interface InventoryLotRow {
  id: Generated<string>;
  item_id: string;
  lot_number: string;
  expires_on: string | null;
  created_at: Generated<Date>;
}

export interface InventoryLedgerRow {
  id: Generated<string>;
  item_id: string;
  location_id: string;
  lot_id: string | null;
  quantity_base: ColumnType<number, number | string, number | string>;
  movement: string;
  reason: string;
  created_at: Generated<Date>;
}

export interface RequisitionRow {
  id: Generated<string>;
  facility_id: string;
  item_id: string;
  quantity_base: ColumnType<number, number | string, number | string>;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface PurchaseOrderRow {
  id: Generated<string>;
  requisition_id: string;
  supplier: string;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface WorkflowTaskRow {
  id: Generated<string>;
  kind: string;
  patient_id: string | null;
  facility_id: string;
  payload: ColumnType<unknown, string, string>;
  status: ColumnType<string, string | undefined, string>;
  due_at: ColumnType<Date | null, string | Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
}

export interface NotificationRow {
  id: Generated<string>;
  channel: string;
  recipient: string;
  body: string;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface DocumentRow {
  id: Generated<string>;
  patient_id: string | null;
  encounter_id: string | null;
  name: string;
  mime: string;
  storage_key: string;
  created_at: Generated<Date>;
}

export interface RevenueServiceRow {
  id: Generated<string>;
  code: string;
  name: string;
  default_price: ColumnType<number, number | string, number | string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface ChargeRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string | null;
  service_code: string;
  quantity: ColumnType<number, number | string, number | string>;
  unit_price: ColumnType<number, number | string, number | string>;
  status: ColumnType<string, string | undefined, string>;
  cancel_reason: string | null;
  source_event_id: string | null;
  created_at: Generated<Date>;
}

export interface InvoiceRow {
  id: Generated<string>;
  patient_id: string;
  status: ColumnType<string, string | undefined, string>;
  void_reason: string | null;
  created_at: Generated<Date>;
}

export interface InvoiceLineRow {
  id: Generated<string>;
  invoice_id: string;
  charge_id: string;
  amount: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
}

export interface PaymentRow {
  id: Generated<string>;
  invoice_id: string;
  amount: ColumnType<number, number | string, number | string>;
  method: string;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface AdjustmentRow {
  id: Generated<string>;
  invoice_id: string;
  amount: ColumnType<number, number | string, number | string>;
  kind: string;
  reason: string;
  created_at: Generated<Date>;
}

export interface CoverageRow {
  id: Generated<string>;
  patient_id: string;
  payer: string;
  plan: string;
  member_id: string;
  effective_from: ColumnType<string, string | Date, string>;
  effective_to: ColumnType<string | null, string | Date | null | undefined, string | null>;
  created_at: Generated<Date>;
}

export interface AuthorizationRow {
  id: Generated<string>;
  coverage_id: string;
  encounter_id: string;
  approved_amount: ColumnType<number, number | string, number | string>;
  status: string;
  created_at: Generated<Date>;
}

export interface ClaimRow {
  id: Generated<string>;
  invoice_id: string;
  payer: string;
  status: ColumnType<string, string | undefined, string>;
  denial_reason: string | null;
  created_at: Generated<Date>;
}

export interface BillingRuleRow {
  id: Generated<string>;
  event_type: string;
  service_code: string | null;
  code_field: string | null;
  quantity: ColumnType<number, number | string, number | string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface AllocationRow {
  id: Generated<string>;
  charge_id: string;
  party_type: string;
  party_ref: string;
  share_pct: ColumnType<number, number | string, number | string>;
  amount: ColumnType<number, number | string, number | string>;
  tariff_id: string | null;
  created_at: Generated<Date>;
}

export interface ClaimLineRow {
  id: Generated<string>;
  claim_id: string;
  charge_id: string;
  amount: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
}

export interface ClaimSubmissionRow {
  id: Generated<string>;
  claim_id: string;
  version: number;
  payer_claim_id: string | null;
  created_at: Generated<Date>;
}

export interface EligibilityCheckRow {
  id: Generated<string>;
  coverage_id: string;
  encounter_id: string | null;
  method: string;
  evidence: string;
  verified_by: string | null;
  result: string;
  created_at: Generated<Date>;
}

export interface PreauthCaseRow {
  id: Generated<string>;
  coverage_id: string;
  encounter_id: string;
  lines: ColumnType<unknown, string, string>;
  status: ColumnType<string, string | undefined, string>;
  decision_note: ColumnType<string, string | undefined, string>;
  expires_on: string | null;
  created_at: Generated<Date>;
}

export interface ConsentRow {
  id: Generated<string>;
  patient_id: string;
  grantee: string;
  purpose: string;
  scope: string;
  status: ColumnType<string, string | undefined, string>;
  valid_from: Generated<Date>;
  valid_to: ColumnType<Date | null, string | Date | null | undefined, Date | null>;
  withdraw_reason: string | null;
  created_at: Generated<Date>;
}

export interface DisclosureRow {
  id: Generated<string>;
  patient_id: string;
  grantee: string;
  purpose: string;
  case_id: string | null;
  created_at: Generated<Date>;
}

export interface ReferralCaseRow {
  id: Generated<string>;
  patient_id: string;
  sending_facility_id: string;
  receiving_facility_id: string | null;
  type: string;
  urgency: ColumnType<string, string | undefined, string>;
  clinical_question: string;
  status: ColumnType<string, string | undefined, string>;
  package_version: ColumnType<number, number | undefined, number>;
  cancel_reason: string | null;
  created_at: Generated<Date>;
}

export interface ReferralPackageRow {
  id: Generated<string>;
  case_id: string;
  version: number;
  payload: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
}

export interface ReferralMessageRow {
  id: Generated<string>;
  case_id: string;
  author_id: string | null;
  body: string;
  created_at: Generated<Date>;
}

export interface IntegrationPartnerRow {
  id: Generated<string>;
  name: string;
  api_key_hash: string;
  scopes: string[];
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface FhirLogRow {
  id: Generated<string>;
  partner_id: string | null;
  resource_type: string;
  resource_id: string | null;
  status: number;
  created_at: Generated<Date>;
}

export interface ExternalResourceRow {
  id: Generated<string>;
  partner_id: string;
  idempotency_key: string | null;
  request_fingerprint: string;
  resource_type: string;
  method: ColumnType<string, string | undefined, string>;
  internal_id: string;
  outcome: string;
  source_system: ColumnType<string, string | undefined, string>;
  received_at: Generated<Date>;
}

export interface PortalAccountRow {
  id: Generated<string>;
  patient_id: string;
  login_id: string;
  secret_hash: string;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface PortalSessionRow {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  acting_patient_id: string;
  scopes: string[];
  expires_at: ColumnType<Date, string | Date, Date>;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface PortalProxyRow {
  id: Generated<string>;
  dependent_patient_id: string;
  proxy_account_id: string;
  relationship: string;
  scopes: string[];
  active: ColumnType<boolean, boolean | undefined, boolean>;
  valid_from: Generated<Date>;
  valid_to: Date | null;
  created_at: Generated<Date>;
}

export interface StaffCredentialRow {
  id: Generated<string>;
  person_id: string | null;
  account_name: string | null;
  login_id: string;
  secret_hash: string;
  status: ColumnType<string, string | undefined, string>;
  totp_secret: string | null;
  totp_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface StaffSessionRow {
  id: Generated<string>;
  credential_id: string;
  person_id: string | null;
  token_hash: string;
  expires_at: ColumnType<Date, string | Date, Date>;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface IdentityLinkRow {
  id: Generated<string>;
  person_id: string;
  provider: string;
  subject: string;
  created_at: Generated<Date>;
}

export interface AcuityRow {
  id: Generated<string>;
  encounter_id: string;
  level: number;
  discriminator: string;
  override_reason: string | null;
  recorded_by: string | null;
  created_at: Generated<Date>;
}

export interface TheatreSuiteRow {
  id: Generated<string>;
  facility_id: string;
  name: string;
  code: string;
  created_at: Generated<Date>;
}

export interface TheatreBookingRow {
  id: Generated<string>;
  encounter_id: string;
  suite_id: string;
  procedure_name: string;
  urgency: ColumnType<string, string | undefined, string>;
  scheduled_at: ColumnType<Date, string | Date, Date>;
  status: ColumnType<string, string | undefined, string>;
  cancel_reason: string | null;
  created_at: Generated<Date>;
}

export interface TheatreChecklistRow {
  id: Generated<string>;
  booking_id: string;
  stage: string;
  items: ColumnType<unknown, string, string>;
  completed_by: string | null;
  created_at: Generated<Date>;
}

export interface TheatreRecordRow {
  id: Generated<string>;
  booking_id: string;
  surgeon: string;
  anesthetist: string;
  notes: string;
  started_at: ColumnType<Date | null, string | Date | null | undefined, Date | null>;
  ended_at: ColumnType<Date | null, string | Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
}

export interface BankUnitRow {
  id: Generated<string>;
  bag_id: string;
  abo: string;
  rh: string;
  expires_on: ColumnType<string, string | Date, string>;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface BankCrossmatchRow {
  id: Generated<string>;
  patient_id: string;
  unit_id: string;
  result: string;
  performed_by: string | null;
  created_at: Generated<Date>;
}

export interface BankTransfusionRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string | null;
  unit_id: string;
  status: ColumnType<string, string | undefined, string>;
  reaction: string | null;
  reaction_note: ColumnType<string, string | undefined, string>;
  started_at: Generated<Date>;
  ended_at: Date | null;
  created_at: Generated<Date>;
}

export interface SyncStateRow {
  consumer_id: string;
  last_created_at: ColumnType<Date | null, string | Date | null | undefined, Date | null>;
  last_id: string | null;
  updated_at: Generated<Date>;
}

export interface SyncConflictRow {
  id: Generated<string>;
  event_id: string;
  event_type: string;
  aggregate_id: string;
  reason: string;
  status: ColumnType<string, string | undefined, string>;
  resolution: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface DeviceRow {
  id: Generated<string>;
  facility_id: string;
  name: string;
  kind: ColumnType<string, string | undefined, string>;
  status: ColumnType<string, string | undefined, string>;
  token_hash: string;
  capabilities: string[];
  max_disconnected_hours: ColumnType<number, number | undefined, number>;
  last_seen_at: Date | null;
  last_heartbeat: Generated<Record<string, unknown>>;
  enrolled_at: Generated<Date>;
  decommissioned_at: Date | null;
  created_at: Generated<Date>;
}

export interface DeviceHeartbeatRow {
  id: Generated<string>;
  device_id: string;
  pending_out: ColumnType<number, number | undefined, number>;
  pending_in: ColumnType<number, number | undefined, number>;
  last_sync_at: Date | null;
  recorded_at: Generated<Date>;
}

export interface SecurityEventRow {
  id: Generated<string>;
  occurred_at: Generated<Date>;
  category: string;
  action: string;
  severity: ColumnType<string, string | undefined, string>;
  actor_type: ColumnType<string, string | undefined, string>;
  actor_id: string | null;
  facility_id: string | null;
  correlation_id: string | null;
  details: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface SecurityFindingRow {
  id: Generated<string>;
  title: string;
  severity: string;
  status: ColumnType<string, string | undefined, string>;
  vector: string | null;
  component: string;
  evidence: string | null;
  owner: string | null;
  remediation: string | null;
  found_at: Generated<Date>;
  triaged_at: Date | null;
  triaged_by: string | null;
  due_at: Date | null;
  created_at: Generated<Date>;
}

export interface AlertRuleRow {
  id: Generated<string>;
  name: string;
  description: string;
  metric: string;
  comparator: string;
  threshold: number;
  window_minutes: ColumnType<number, number | undefined, number>;
  severity: string;
  owner: string;
  runbook: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AlertRow {
  id: Generated<string>;
  rule_id: string;
  state: string;
  value: number;
  started_at: Generated<Date>;
  resolved_at: Date | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  detail: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface BackupRunRow {
  id: Generated<string>;
  kind: string;
  status: string;
  started_at: Generated<Date>;
  finished_at: Date | null;
  rpo_target_minutes: number | null;
  rto_target_seconds: number | null;
  evidence: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface DialProtocolRow {
  id: Generated<string>;
  code: string;
  version: number;
  name: string;
  session_minutes: ColumnType<number, number | undefined, number>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface DialProgramRow {
  id: Generated<string>;
  patient_id: string;
  facility_id: string;
  protocol_id: string;
  access_type: string;
  target_weight_kg: number;
  status: ColumnType<string, string | undefined, string>;
  start_date: ColumnType<string | Date, string | Date | undefined, string | Date>;
  ended_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DialSessionRow {
  id: Generated<string>;
  program_id: string;
  encounter_id: string | null;
  protocol_id: string;
  scheduled_for: Date;
  status: ColumnType<string, string | undefined, string>;
  pre_weight_kg: number | null;
  post_weight_kg: number | null;
  ultrafiltration_l: number | null;
  adverse_event: string | null;
  reason: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Generated<Date>;
}

export interface EqpAssetRow {
  id: Generated<string>;
  facility_id: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  purchase_order_id: string | null;
  status: ColumnType<string, string | undefined, string>;
  commissioned_at: Generated<Date>;
  out_of_service_reason: string | null;
  out_of_service_since: Date | null;
  retired_at: Date | null;
  created_at: Generated<Date>;
}

export interface EqpMaintenanceTaskRow {
  id: Generated<string>;
  asset_id: string;
  kind: string;
  due_at: Date;
  status: ColumnType<string, string | undefined, string>;
  interval_days: number | null;
  completed_at: Date | null;
  completed_note: string | null;
  created_at: Generated<Date>;
}

export interface RosStaffRow {
  id: Generated<string>;
  facility_id: string;
  display_name: string;
  role: string;
  contact: ColumnType<string, string | undefined, string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface RosShiftRow {
  id: Generated<string>;
  staff_id: string;
  facility_id: string;
  kind: string;
  unit: string | null;
  starts_at: Date;
  ends_at: Date;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface RosAssignmentRow {
  id: Generated<string>;
  staff_id: string;
  facility_id: string;
  kind: string;
  unit: string;
  starts_at: Date;
  ends_at: Date | null;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface FlowBedAssignmentRow {
  id: Generated<string>;
  location_id: string;
  encounter_id: string;
  facility_id: string;
  status: ColumnType<string, string | undefined, string>;
  starts_at: Generated<Date>;
  ended_at: Date | null;
  created_at: Generated<Date>;
}

export interface FlowLevelOfCareRow {
  id: Generated<string>;
  encounter_id: string;
  level: string;
  reason: string;
  status: ColumnType<string, string | undefined, string>;
  starts_at: Generated<Date>;
  ended_at: Date | null;
  created_at: Generated<Date>;
}

export interface ResStudyRow {
  id: Generated<string>;
  facility_id: string;
  code: string;
  title: string;
  description: ColumnType<string, string | undefined, string>;
  status: ColumnType<string, string | undefined, string>;
  approved_by: string | null;
  approved_at: Date | null;
  closed_at: Date | null;
  created_at: Generated<Date>;
}

export interface ResCohortDefinitionRow {
  id: Generated<string>;
  study_id: string;
  name: string;
  version: ColumnType<number, number | undefined, number>;
  criteria: ColumnType<string, string | undefined, string>;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface ResDatasetExportRow {
  id: Generated<string>;
  study_id: string;
  cohort_definition_id: string;
  requested_by: string;
  patient_ids: string[];
  status: ColumnType<string, string | undefined, string>;
  row_count: number | null;
  deidentified: ColumnType<boolean, boolean | undefined, boolean>;
  decision_by: string | null;
  decision_note: string | null;
  requested_at: Generated<Date>;
  decided_at: Date | null;
  exported_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface ResSubjectLinkRow {
  id: Generated<string>;
  study_id: string;
  patient_id: string;
  pseudonym: string;
  created_at: Generated<Date>;
}

export interface InsurancePayerRow {
  id: Generated<string>;
  code: string;
  name: string;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface FacilityContractRow {
  id: Generated<string>;
  facility_id: string;
  payer_id: string;
  effective_from: ColumnType<string, string | Date, string>;
  effective_to: ColumnType<string | null, string | Date | null | undefined, string | null>;
  status: ColumnType<string, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface TariffScheduleRow {
  id: Generated<string>;
  contract_id: string;
  version: number;
  effective_from: ColumnType<string, string | Date, string>;
  created_at: Generated<Date>;
}

export interface TariffLineRow {
  id: Generated<string>;
  schedule_id: string;
  service_code: string;
  price: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
}

export interface PlanBenefitRow {
  id: Generated<string>;
  payer_code: string;
  plan: string;
  deductible_annual: ColumnType<number, number | string, number | string>;
  copay_amount: ColumnType<number, number | string, number | string>;
  coinsurance_pct: ColumnType<number, number | string, number | string>;
  effective_from: ColumnType<string, string | Date, string>;
  created_at: Generated<Date>;
}

export interface DeductibleUseRow {
  id: Generated<string>;
  payer_code: string;
  plan: string;
  member_id: string;
  year: number;
  charge_id: string;
  amount: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
}

export interface AnatomyModelRow {
  id: Generated<string>;
  vendor: string;
  model_name: string;
  version: string;
  anatomy_profile: Generated<string>;
  coordinate_system: Generated<string>;
  units: Generated<string>;
  structure_manifest_version: Generated<string>;
  licence: Generated<string>;
  checksum: Generated<string>;
  status: ColumnType<string, string | undefined, string>;
  released_at: Date | null;
  created_at: Generated<Date>;
}

export interface AnatomyStructureRow {
  id: Generated<string>;
  model_id: string;
  vendor_structure_key: string;
  parent_structure_id: string | null;
  level: string;
  name: string;
  code: string;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface StructureMappingRow {
  id: Generated<string>;
  structure_id: string;
  coding_system: string;
  code: string;
  code_version: string;
  approved: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
}

export interface FindingRow {
  id: Generated<string>;
  patient_id: string;
  encounter_id: string;
  facility_id: string;
  anatomy_model_id: string;
  anatomy_structure_id: string;
  laterality: string | null;
  finding_type: string;
  finding_text: string;
  severity: string | null;
  effective_at: ColumnType<Date, string | Date | undefined, string | Date>;
  recorded_at: ColumnType<Date, string | Date | undefined, never>;
  author_id: string;
  status: ColumnType<string, string | undefined, string>;
  version: ColumnType<number, number | undefined, number>;
  geometry: ColumnType<unknown, string, string>;
  client_ref: string | null;
  amends_id: string | null;
  amendment_reason: string | null;
  error_reason: string | null;
  signed_by: string | null;
  signed_at: Date | null;
  created_at: Generated<Date>;
}

export interface FindingLinkRow {
  id: Generated<string>;
  finding_id: string;
  target_type: string;
  target_id: string;
  created_at: Generated<Date>;
}

export interface PulseDatabase {
  'integration.outbox': OutboxRow;
  'integration.inbox': InboxRow;
  'audit.audit_event': AuditEventRow;
  'org.organization': OrganizationRow;
  'org.facility': FacilityRow;
  'org.department': DepartmentRow;
  'org.unit': UnitRow;
  'org.location': LocationRow;
  'iam.membership': MembershipRow;
  'iam.credential': StaffCredentialRow;
  'iam.session': StaffSessionRow;
  'iam.identity_link': IdentityLinkRow;
  'iam.care_assignment': CareAssignmentRow;
  'iam.break_glass_grant': BreakGlassGrantRow;
  'patient.patient': PatientRow;
  'patient.identifier': PatientIdentifierRow;
  'patient.merge_link': MergeLinkRow;
  'encounter.encounter': EncounterRow;
  'encounter.transfer': EncounterTransferRow;
  'sched.appointment': AppointmentRow;
  'clin.observation': ObservationRow;
  'clin.note': NoteRow;
  'clin.note_addendum': NoteAddendumRow;
  'clin.entry': EntryRow;
  'lab.test': LabTestRow;
  'lab.lab_order': LabOrderRow;
  'lab.specimen': LabSpecimenRow;
  'lab.result': LabResultRow;
  'img.img_order': ImagingOrderRow;
  'img.study': ImagingStudyRow;
  'img.report': ImagingReportRow;
  'med.medication': MedicationRow;
  'med.request': MedRequestRow;
  'med.dispense': MedDispenseRow;
  'med.administration': MedAdministrationRow;
  'inv.item': InventoryItemRow;
  'inv.location': InventoryLocationRow;
  'inv.lot': InventoryLotRow;
  'inv.ledger': InventoryLedgerRow;
  'inv.requisition': RequisitionRow;
  'inv.purchase_order': PurchaseOrderRow;
  'workflow.task': WorkflowTaskRow;
  'workflow.notification': NotificationRow;
  'docs.document': DocumentRow;
  'rev.service': RevenueServiceRow;
  'rev.charge': ChargeRow;
  'rev.invoice': InvoiceRow;
  'rev.invoice_line': InvoiceLineRow;
  'rev.payment': PaymentRow;
  'rev.adjustment': AdjustmentRow;
  'rev.coverage': CoverageRow;
  'rev.authorization': AuthorizationRow;
  'rev.claim': ClaimRow;
  'rev.billing_rule': BillingRuleRow;
  'rev.allocation': AllocationRow;
  'rev.claim_line': ClaimLineRow;
  'rev.claim_submission': ClaimSubmissionRow;
  'ins.eligibility_check': EligibilityCheckRow;
  'ins.preauth_case': PreauthCaseRow;
  'consent.consent': ConsentRow;
  'consent.disclosure': DisclosureRow;
  'referral.case': ReferralCaseRow;
  'referral.package': ReferralPackageRow;
  'referral.message': ReferralMessageRow;
  'integration.partner': IntegrationPartnerRow;
  'integration.fhir_log': FhirLogRow;
  'integration.external_resource': ExternalResourceRow;
  'portal.account': PortalAccountRow;
  'portal.session': PortalSessionRow;
  'portal.proxy_grant': PortalProxyRow;
  'emg.acuity': AcuityRow;
  'theat.suite': TheatreSuiteRow;
  'theat.booking': TheatreBookingRow;
  'theat.checklist': TheatreChecklistRow;
  'theat.record': TheatreRecordRow;
  'bank.unit': BankUnitRow;
  'bank.crossmatch': BankCrossmatchRow;
  'bank.transfusion': BankTransfusionRow;
  'integration.sync_state': SyncStateRow;
  'integration.sync_conflict': SyncConflictRow;
  'integration.device': DeviceRow;
  'integration.device_heartbeat': DeviceHeartbeatRow;
  'security.event': SecurityEventRow;
  'security.finding': SecurityFindingRow;
  'ops.alert_rule': AlertRuleRow;
  'ops.alert': AlertRow;
  'ops.backup_run': BackupRunRow;
  'ins.payer': InsurancePayerRow;
  'ins.facility_contract': FacilityContractRow;
  'ins.tariff_schedule': TariffScheduleRow;
  'ins.tariff_line': TariffLineRow;
  'ins.plan_benefit': PlanBenefitRow;
  'ins.deductible_use': DeductibleUseRow;
  'anat.anatomy_model': AnatomyModelRow;
  'anat.anatomy_structure': AnatomyStructureRow;
  'anat.structure_mapping': StructureMappingRow;
  'anat.finding': FindingRow;
  'anat.finding_link': FindingLinkRow;
  'dial.protocol': DialProtocolRow;
  'dial.program': DialProgramRow;
  'dial.session': DialSessionRow;
  'eqp.asset': EqpAssetRow;
  'eqp.maintenance_task': EqpMaintenanceTaskRow;
  'ros.staff': RosStaffRow;
  'ros.shift': RosShiftRow;
  'ros.assignment': RosAssignmentRow;
  'flow.bed_assignment': FlowBedAssignmentRow;
  'flow.level_of_care': FlowLevelOfCareRow;
  'res.study': ResStudyRow;
  'res.cohort_definition': ResCohortDefinitionRow;
  'res.dataset_export': ResDatasetExportRow;
  'res.subject_link': ResSubjectLinkRow;
}
