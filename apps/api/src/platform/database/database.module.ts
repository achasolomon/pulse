import { Global, Module } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { PulseDatabase } from './db.types.js';

export const PULSE_DB = 'PULSE_DB';

/**
 * Sprint 01 wiring: Kysely instance only (ADR-006).
 * No queries issued at boot; relay + repositories land in Sprint 02.
 * Pool connects lazily so unit/e2e pass without a database.
 */
@Global()
@Module({
  providers: [
    {
      provide: PULSE_DB,
      useFactory: (): Kysely<PulseDatabase> => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL ?? '',
          max: 5,
        });
        return new Kysely<PulseDatabase>({
          dialect: new PostgresDialect({ pool }),
        });
      },
    },
  ],
  exports: [PULSE_DB],
})
export class DatabaseModule {}
