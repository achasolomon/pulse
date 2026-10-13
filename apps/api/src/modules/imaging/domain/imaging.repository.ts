/** Imaging domain (IMG-001, EPIC-11). Pixels stay in PACS; Pulse keeps refs + reports. */

export type ImagingStatus =
  | 'ordered'
  | 'scheduled'
  | 'protocolled'
  | 'acquired'
  | 'reported'
  | 'final'
  | 'cancelled';

/** Body regions requiring explicit laterality at order time. */
const PAIRED_REGIONS = new Set([
  'kidney',
  'lung',
  'breast',
  'eye',
  'ear',
  'arm',
  'leg',
  'hand',
  'foot',
  'ovary',
  'testis',
  'shoulder',
  'hip',
  'knee',
]);

export function requiresLaterality(bodyRegion: string): boolean {
  return PAIRED_REGIONS.has(bodyRegion.trim().toLowerCase());
}

/** Pure order machine. Throws Error('IMG_TRANSITION:...') on illegal moves. */
export function transitionImaging(
  from: ImagingStatus,
  action: 'schedule' | 'protocol' | 'acquire' | 'report' | 'finalize' | 'cancel',
): ImagingStatus {
  if (action === 'cancel') {
    if (from === 'final' || from === 'cancelled') {
      throw new Error(`IMG_TRANSITION:${from}->${action}`);
    }
    return 'cancelled';
  }
  const next: Record<string, ImagingStatus> = {
    'ordered:schedule': 'scheduled',
    'scheduled:protocol': 'protocolled',
    'protocolled:acquire': 'acquired',
    'acquired:report': 'reported',
    'reported:report': 'reported',
    'reported:finalize': 'final',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`IMG_TRANSITION:${from}->${action}`);
  return to;
}

export const IMAGING_REPOSITORY = 'IMAGING_REPOSITORY';

export interface ImagingRepository {
  order(input: {
    patientId: string;
    encounterId: string;
    procedureCode: string;
    bodyRegion: string;
    laterality?: string;
    indication: string;
    urgency: 'stat' | 'urgent' | 'routine';
  }): Promise<{ id: string; status: ImagingStatus }>;
  findOrder(id: string): Promise<{ id: string; status: ImagingStatus } | undefined>;
  setStatus(id: string, status: ImagingStatus, cancelReason?: string): Promise<void>;
  linkStudy(orderId: string, input: {
    studyUid: string;
    accession: string;
    modality: string;
    pacsRef: string;
  }): Promise<{ id: string }>;
  saveReport(orderId: string, input: { text: string; authorId?: string }): Promise<{ id: string; version: number }>;
  finalizeReport(orderId: string): Promise<{ version: number }>;
  worklist(statuses: ImagingStatus[], limit: number): Promise<{ id: string; status: ImagingStatus }[]>;
}
