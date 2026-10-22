import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { PulseDatabase } from './db.types.js';
export interface StaffCommandScope {
  personId: string;
  organizationId: string;
  facilityId: string;
}
/** Infrastructure-only transaction helper. Receipts contain resource IDs, not request narratives. */
export async function staffCommand<T>(
  db: Kysely<PulseDatabase>,
  scope: StaffCommandScope,
  key: string,
  action: string,
  input: unknown,
  work: (trx: Transaction<PulseDatabase>) => Promise<T>,
): Promise<T> {
  const hash = createHash('sha256')
    .update(JSON.stringify({ action, input }))
    .digest('hex');
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.organizationId}/${scope.facilityId}/${scope.personId}/${key}`},0))`.execute(
      trx,
    );
    const old = await sql<{
      action: string;
      request_hash: string;
      result: T;
    }>`SELECT action,request_hash,result FROM integration.staff_command
      WHERE organization_id=${scope.organizationId}::uuid AND facility_id=${scope.facilityId}::uuid AND actor_id=${scope.personId}::uuid AND command_key=${key}::uuid`.execute(
      trx,
    );
    if (old.rows[0]) {
      if (old.rows[0].action !== action || old.rows[0].request_hash !== hash)
        throw new ConflictException({
          code: 'COMMAND_KEY_REUSED',
          message:
            'This submission key was already used for a different action. Reload and try again.',
        });
      return old.rows[0].result;
    }
    const result = await work(trx);
    await sql`INSERT INTO integration.staff_command(organization_id,facility_id,actor_id,command_key,action,request_hash,result)
      VALUES(${scope.organizationId}::uuid,${scope.facilityId}::uuid,${scope.personId}::uuid,${key}::uuid,${action},${hash},${JSON.stringify(result)}::jsonb)`.execute(
      trx,
    );
    return result;
  });
}
export async function commandEvidence(
  trx: Transaction<PulseDatabase>,
  scope: StaffCommandScope,
  resourceType: string,
  id: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  await trx
    .insertInto('integration.outbox')
    .values({
      aggregate_type: resourceType,
      aggregate_id: id,
      type: action,
      version: 1,
      producer:
        ['observation','note','entry','allergy_review'].includes(resourceType)
          ? 'clinical'
          : resourceType === 'appointment'
            ? 'scheduling'
            : resourceType === 'lab_order'
              ? 'laboratory'
            : resourceType === 'imaging_order'
              ? 'imaging'
            : resourceType === 'outpatient_visit'
              ? 'encounter'
              : resourceType,
      payload: JSON.stringify({ id, facilityId: scope.facilityId, ...payload }),
    })
    .execute();
  await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)
    VALUES(${scope.personId}::uuid,'staff',${action},${resourceType},${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid,${JSON.stringify(payload)}::jsonb)`.execute(
    trx,
  );
}
