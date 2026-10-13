/** Documents domain (ARCH-001 section 17, EPIC-15 F15.3). Blobs in object storage; Postgres keeps the pointer. */

export const DOCUMENT_REPOSITORY = 'DOCUMENT_REPOSITORY';

export interface DocumentRepository {
  register(input: {
    patientId?: string;
    encounterId?: string;
    name: string;
    mime: string;
    storageKey: string;
  }): Promise<{ id: string }>;
  listForPatient(patientId: string, limit: number): Promise<
    { id: string; name: string; mime: string; storageKey: string }[]
  >;
}
