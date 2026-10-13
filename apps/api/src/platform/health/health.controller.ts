import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../database/database.module.js';
import type { PulseDatabase } from '../database/db.types.js';

type DbCheck = 'up' | 'down' | 'not-configured';

@Controller('health')
export class HealthController {
  constructor(@Optional() @Inject(PULSE_DB) private readonly db?: Kysely<PulseDatabase>) {}

  @Get('live')
  live(): { status: string; checks: Record<string, string> } {
    return { status: 'ok', checks: { app: 'up' } };
  }

  /**
   * Readiness detail (OPS-001). `status` stays `ok` while the app serves;
   * orchestrators gate traffic on `checks.db`: `up` is ready, `down` is not,
   * `not-configured` is expected in DB-less test/dev.
   */
  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    return { status: 'ok', checks: { app: 'up', db: await this.checkDb() } };
  }

  private async checkDb(): Promise<DbCheck> {
    if (!process.env.DATABASE_URL || !this.db) return 'not-configured';
    try {
      await sql`SELECT 1`.execute(this.db);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
