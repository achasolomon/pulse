import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { HealthController } from './../src/platform/health/health.controller.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('readiness vs live DB', () => {
  it('reports db: up', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    try {
      const ready = await new HealthController(db).ready();
      expect(ready.status).toBe('ok');
      expect(ready.checks.db).toBe('up');
    } finally {
      await db.destroy();
    }
  });
});
