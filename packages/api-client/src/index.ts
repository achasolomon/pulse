export {
  createApiClient,
  ApiError,
  CORRELATION_HEADER,
  TENANT_HEADER,
  FACILITY_HEADER,
  PATIENT_HEADER,
  type ApiClient,
  type ApiClientContext,
  type ApiClientOptions,
  type RequestOptions,
} from './client.js';
export { createAuthApi, type AuthApi, type LoginInput, type LoginResult, type LogoutResult } from './auth.js';
export { problemToApiError, type ProblemDetails, type ApiErrorKind } from './errors.js';
export type { StaffContext, StaffFacilityContext, StaffWebSession, StaffAccountSecurity } from '@pulse/api-contracts';
export { createStaffWebApi } from './staff-web.js';
export type { StaffNotification, StaffInboxPage, StaffAssignedTask } from '@pulse/api-contracts';
export type { StaffPatientIdentity, StaffPatientPage, StaffChartOverview, VitalAssessment } from '@pulse/api-contracts';
export type { PatientRegistrationInput, PatientRegistrationResult, OutpatientVisit, OutpatientStage, VitalMeasurement, ConsultationStaff } from '@pulse/api-contracts';
export type {StaffChartSection, StaffChartHistoryItem, StaffChartHistoryPage} from '@pulse/api-contracts';
export type {StaffClinicalNote,StaffNoteContent,StaffNoteContext,StaffNoteSaveInput} from '@pulse/api-contracts';
export type {StaffNoteDraftContent,NoteDocument,NoteNode,NoteFormatting} from '@pulse/api-contracts';
export {validNoteDocument,noteDocumentText,plainNoteDocument,appendNoteDocument} from '@pulse/api-contracts';
export type {StaffProblemContext,StaffProblemEntry,StaffProblemInput,StaffProblemResolution} from '@pulse/api-contracts';
export type {StaffAllergy,StaffAllergyRecord,StaffAllergyInput,StaffAllergyReviewInput,StaffAllergyCorrectionInput,AllergyReviewStatus,AllergyInformationSource} from '@pulse/api-contracts';
export type {StaffLabTest,StaffLabOrder,StaffLabOrderInput,StaffLabCancellation} from '@pulse/api-contracts';
export type {StaffImagingProcedure,StaffImagingOrder,StaffImagingOrderInput} from '@pulse/api-contracts';
export type {StaffLabDutyOrder,StaffLabQueuePage,StaffLabCollection,StaffLabAccession,StaffLabSpecimen} from '@pulse/api-contracts';
export type {StaffImagingDutyDetail,StaffImagingProtocolInput,StaffImagingProtocolTemplate} from '@pulse/api-contracts';
export type {StaffImagingSlot,StaffImagingScheduleInput} from '@pulse/api-contracts';
export type {StaffImagingAcquisition,StaffImagingAcquisitionInput,StaffImagingAcquisitionConfirm} from '@pulse/api-contracts';
export type {StaffImagingReportContent,StaffImagingReportInput,StaffImagingReportSignoff,StaffImagingReporting} from '@pulse/api-contracts';
export type {StaffImagingHandoff,StaffImagingHandoffDetail} from '@pulse/api-contracts';
