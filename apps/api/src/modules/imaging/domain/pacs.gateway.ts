import type {StaffPacsStatus} from '@pulse/api-contracts';
export const PACS_GATEWAY='PACS_GATEWAY';
/** Values generated or read from the scoped acquisition work item, never browser lookup parameters. */
export interface PacsStudyBinding {studyUid:string;patientId:string;issuer:string;accession:string;modality:string;birthDate:string|null;}
export type PacsStudyVerification = {verified:true;studyUid:string;seriesCount:number;instanceCount:number;checkedAt:string}|{verified:false;reason:'not-configured'|'invalid-configuration'|'authentication-failed'|'unavailable'|'invalid-response'|'not-found'|'identity-mismatch';checkedAt:string};
export interface PacsGateway {status():Promise<StaffPacsStatus>;verifyStudy(binding:PacsStudyBinding):Promise<PacsStudyVerification>;}
