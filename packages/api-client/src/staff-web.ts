import type { StaffWebSession, StaffAccountSecurity, StaffInboxPage, StaffAssignedTask } from '@pulse/api-contracts';
import { createApiClient, type ApiClientOptions } from './client.js';
import type { LoginInput } from './auth.js';

/** Browser transport talks only to same-origin BFF routes. HttpOnly cookies
 * are attached by the browser; bearer tokens never enter browser JavaScript. */
export function createStaffWebApi(options: Partial<Pick<ApiClientOptions, 'fetchImpl' | 'newCorrelationId'>> = {}) {
  const client = createApiClient({ baseUrl: '/api/auth', ...options });
  return {
    labQueue(status:string,q:string,cursor?:string,signal?:AbortSignal){const params=new URLSearchParams({status,q});if(cursor)params.set('cursor',cursor);return client.request<import('@pulse/api-contracts').StaffLabQueuePage>(`/laboratory/queue?${params}`,{signal});},
    labDutyOrder(id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffLabDutyOrder>(`/laboratory/orders/${id}`,{signal});},
    imagingCatalogue(patientId:string,q:string,signal?:AbortSignal){return client.request<{items:import('@pulse/api-contracts').StaffImagingProcedure[];hasMore:boolean}>(`/imaging/${patientId}/catalogue?q=${encodeURIComponent(q)}`,{signal});},
    imagingContexts(patientId:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffProblemContext[]>(`/imaging/${patientId}/contexts`,{signal});},
    imagingOrder(patientId:string,id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffImagingOrder>(`/imaging/${patientId}/orders/${id}`,{signal});},
    placeImagingOrder(patientId:string,input:import('@pulse/api-contracts').StaffImagingOrderInput){return client.request<import('@pulse/api-contracts').StaffImagingOrder>(`/imaging/${patientId}/orders`,{method:'POST',body:input});},
    cancelImagingOrder(patientId:string,id:string,input:import('@pulse/api-contracts').StaffLabCancellation){return client.request<import('@pulse/api-contracts').StaffImagingOrder>(`/imaging/${patientId}/orders/${id}/cancel`,{method:'POST',body:input});},
    criticalCount(signal?:AbortSignal){return client.request<{pending:number;overdue:number}>('/critical-results/count',{signal});},
    criticalQueue(cursor?:string,signal?:AbortSignal){return client.request<{items:import('@pulse/api-contracts').StaffCriticalCase[];nextCursor:string|null}>(`/critical-results${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{signal});},
    criticalDetail(id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffCriticalDetail>(`/critical-results/orders/${id}`,{signal});},
    criticalRecipients(id:string,signal?:AbortSignal){return client.request<{id:string;label:string}[]>(`/critical-results/orders/${id}/recipients`,{signal});},
    notifyCritical(id:string,input:import('@pulse/api-contracts').StaffCriticalNotify){return client.request<import('@pulse/api-contracts').StaffCriticalDetail>(`/critical-results/orders/${id}/notify`,{method:'POST',body:input});},
    contactCritical(id:string,input:import('@pulse/api-contracts').StaffCriticalAttempt){return client.request<import('@pulse/api-contracts').StaffCriticalDetail>(`/critical-results/orders/${id}/attempt`,{method:'POST',body:input});},
    acknowledgeCritical(id:string,input:import('@pulse/api-contracts').StaffCriticalAck){return client.request<import('@pulse/api-contracts').StaffCriticalDetail>(`/critical-results/orders/${id}/acknowledge`,{method:'POST',body:input});},
    configureCriticalBackup(id:string,input:import('@pulse/api-contracts').StaffCriticalBackup){return client.request<import('@pulse/api-contracts').StaffCriticalDetail>(`/critical-results/orders/${id}/backup`,{method:'POST',body:input});},
    stageLabResult(id:string,input:import('@pulse/api-contracts').StaffLabResultInput){return client.request<import('@pulse/api-contracts').StaffLabDutyOrder>(`/laboratory/orders/${id}/results`,{method:'POST',body:input});},
    verifyLabResults(id:string,input:import('@pulse/api-contracts').StaffLabVerification){return client.request<import('@pulse/api-contracts').StaffLabDutyOrder>(`/laboratory/orders/${id}/verify`,{method:'POST',body:input});},
    collectLabSpecimen(id:string,input:import('@pulse/api-contracts').StaffLabCollection){return client.request<import('@pulse/api-contracts').StaffLabDutyOrder>(`/laboratory/orders/${id}/collect`,{method:'POST',body:input});},
    accessionLabSpecimen(id:string,input:import('@pulse/api-contracts').StaffLabAccession){return client.request<import('@pulse/api-contracts').StaffLabDutyOrder>(`/laboratory/orders/${id}/accession`,{method:'POST',body:input});},
    labContexts(patientId:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffProblemContext[]>(`/lab/${patientId}/contexts`,{signal});},
    labCatalogue(patientId:string,q:string,signal?:AbortSignal){return client.request<{items:import('@pulse/api-contracts').StaffLabTest[];hasMore:boolean}>(`/lab/${patientId}/catalogue?q=${encodeURIComponent(q)}`,{signal});},
    labOrder(patientId:string,id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffLabOrder>(`/lab/${patientId}/orders/${id}`,{signal});},
    placeLabOrder(patientId:string,input:import('@pulse/api-contracts').StaffLabOrderInput){return client.request<import('@pulse/api-contracts').StaffLabOrder>(`/lab/${patientId}/orders`,{method:'POST',body:input});},
    cancelLabOrder(patientId:string,id:string,input:import('@pulse/api-contracts').StaffLabCancellation){return client.request<import('@pulse/api-contracts').StaffLabOrder>(`/lab/${patientId}/orders/${id}/cancel`,{method:'POST',body:input});},
    allergyRecord(patientId:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffAllergyRecord>(`/allergies/${patientId}`,{signal});},
    addAllergy(patientId:string,input:import('@pulse/api-contracts').StaffAllergyInput){return client.request<import('@pulse/api-contracts').StaffAllergyRecord>(`/allergies/${patientId}/add`,{method:'POST',body:input});},
    reviewAllergies(patientId:string,input:import('@pulse/api-contracts').StaffAllergyReviewInput){return client.request<import('@pulse/api-contracts').StaffAllergyRecord>(`/allergies/${patientId}/review`,{method:'POST',body:input});},
    correctAllergy(patientId:string,id:string,input:import('@pulse/api-contracts').StaffAllergyCorrectionInput){return client.request<import('@pulse/api-contracts').StaffAllergyRecord>(`/allergies/${patientId}/${id}/entered-in-error`,{method:'POST',body:input});},
    problemContexts(patientId:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffProblemContext[]>(`/problems/${patientId}/contexts`,{signal});},
    problemEntry(patientId:string,id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffProblemEntry>(`/problems/${patientId}/${id}`,{signal});},
    createProblem(patientId:string,input:import('@pulse/api-contracts').StaffProblemInput){return client.request<import('@pulse/api-contracts').StaffProblemEntry>(`/problems/${patientId}/create`,{method:'POST',body:input});},
    resolveProblem(patientId:string,id:string,input:import('@pulse/api-contracts').StaffProblemResolution){return client.request<import('@pulse/api-contracts').StaffProblemEntry>(`/problems/${patientId}/${id}/resolve`,{method:'POST',body:input});},
    noteContexts(patientId:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffNoteContext[]>(`/notes/contexts/${patientId}`,{signal});},
    clinicalNote(id:string,signal?:AbortSignal){return client.request<import('@pulse/api-contracts').StaffClinicalNote>(`/notes/${id}`,{signal});},
    createClinicalNote(patientId:string,input:import('@pulse/api-contracts').StaffNoteSaveInput){return client.request<import('@pulse/api-contracts').StaffClinicalNote>(`/notes/patients/${patientId}`,{method:'POST',body:input});},
    saveClinicalNote(id:string,input:import('@pulse/api-contracts').StaffNoteDraftContent&{commandKey:string;expectedVersion:number}){return client.request<import('@pulse/api-contracts').StaffClinicalNote>(`/notes/${id}/save`,{method:'POST',body:input});},
    signClinicalNote(id:string,input:{commandKey:string;expectedVersion:number;attestation:boolean}){return client.request<import('@pulse/api-contracts').StaffClinicalNote>(`/notes/${id}/sign`,{method:'POST',body:input});},
    amendClinicalNote(id:string,input:{commandKey:string;text:string}){return client.request<import('@pulse/api-contracts').StaffClinicalNote>(`/notes/${id}/addenda`,{method:'POST',body:input});},
    chartHistory(id: string, section: import('@pulse/api-contracts').StaffChartSection, cursor?: string, signal?: AbortSignal, encounterId?: string) { const query=new URLSearchParams(); if(cursor)query.set('cursor',cursor);if(encounterId)query.set('encounterId',encounterId); return client.request<import('@pulse/api-contracts').StaffChartHistoryPage>(`/patients/${encodeURIComponent(id)}/history/${section}?${query}`,{signal}); },
    registerPatient(input: PatientRegistrationInput) { return client.request<PatientRegistrationResult>('/patients/register', { method: 'POST', body: input }); },
    visits(queue: string, signal?: AbortSignal) { return client.request<OutpatientVisit[]>(`/visits?queue=${encodeURIComponent(queue)}`, { signal }); },
    currentVisit(patientId: string, signal?: AbortSignal) { return client.request<OutpatientVisit | null>(`/visits/patient/${encodeURIComponent(patientId)}`, { signal }); },
    checkInPatient(patientId: string, commandKey: string) { return client.request<OutpatientVisit>('/visits/check-in', { method: 'POST', body: { patientId, commandKey } }); },
    claimVisit(id: string, commandKey: string) { return client.request<OutpatientVisit>(`/visits/${id}/claim`, { method: 'POST', body: { commandKey } }); },
    recordVitals(id: string, measurements: VitalMeasurement[], takenAt: string, commandKey: string) { return client.request<{visitId:string;recorded:number}>(`/visits/${id}/vitals`, { method: 'POST', body: { measurements, takenAt, commandKey } }); },
    consultationStaff(signal?: AbortSignal) { return client.request<ConsultationStaff[]>('/visits/clinicians', { signal }); },
    handoffVisit(id: string, clinicianId: string, commandKey: string) { return client.request<OutpatientVisit>(`/visits/${id}/handoff`, { method: 'POST', body: { clinicianId, commandKey } }); },
    startConsultation(id: string, commandKey: string) { return client.request<OutpatientVisit>(`/visits/${id}/start`, { method: 'POST', body: { commandKey } }); },
    patients(options: { query?: string; status?: string; cursor?: string; signal?: AbortSignal } = {}) {
      return client.request<StaffPatientPage>('/patients/search', { method: 'POST', body: { query: options.query ?? '', status: options.status ?? 'active', ...(options.cursor ? { cursor: options.cursor } : {}) }, signal: options.signal });
    },
    patientChart(id: string, signal?: AbortSignal) { return client.request<StaffChartOverview>(`/patients/${encodeURIComponent(id)}/chart`, { signal }); },
    notifications(options: { unread?: boolean; cursor?: string; signal?: AbortSignal } = {}) {
      const query = new URLSearchParams();
      if (options.unread) query.set('unread', 'true');
      if (options.cursor) query.set('cursor', options.cursor);
      return client.request<StaffInboxPage>(`/inbox/notifications?${query}`, { signal: options.signal });
    },
    readNotification(id: string) { return client.request<{ read: boolean }>(`/inbox/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }); },
    assignedTask(id: string, signal?: AbortSignal) { return client.request<StaffAssignedTask>(`/inbox/tasks/${encodeURIComponent(id)}`, { signal }); },
    security() { return client.request<StaffAccountSecurity>('/account/security'); },
    requestPasswordReset(loginId: string) { return client.request<{accepted:boolean}>('/account/password-request',{method:'POST',body:{loginId}}); },
    resetPassword(token: string, secret: string) { return client.request<{changed:boolean}>('/account/password-reset',{method:'POST',body:{token,secret}}); },
    requestRecoveryEmail(email: string, secret: string, totp?: string) { return client.request<{accepted:boolean}>('/account/email-request',{method:'POST',body:{email,secret,...(totp?{totp}:{})}}); },
    verifyRecoveryEmail(token: string) { return client.request<{verified:boolean}>('/account/email-verify',{method:'POST',body:{token}}); },
    enrollMfa(secret: string) { return client.request<{otpauthUrl:string}>('/account/mfa-enroll',{method:'POST',body:{secret}}); },
    confirmMfa(totp: string) { return client.request<{enabled:boolean}>('/account/mfa-confirm',{method:'POST',body:{totp}}); },
    disableMfa(secret: string, totp: string) { return client.request<{enabled:boolean}>('/account/mfa-disable',{method:'POST',body:{secret,totp}}); },
    login(input: LoginInput) { return client.request<StaffWebSession>('/login', { method: 'POST', body: input }); },
    session(signal?: AbortSignal) { return client.request<StaffWebSession>('/session', { signal }); },
    logout() { return client.request<{ ok: boolean }>('/logout', { method: 'POST' }); },
    selectFacility(facilityId: string) { return client.request<{ ok: boolean }>('/facility', { method: 'POST', body: { facilityId } }); },
  };
}
import type { StaffPatientPage, StaffChartOverview } from '@pulse/api-contracts';
import type { PatientRegistrationInput, PatientRegistrationResult, OutpatientVisit, VitalMeasurement, ConsultationStaff } from '@pulse/api-contracts';
