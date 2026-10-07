import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: string; checks: Record<string, string> } {
    return { status: 'ok', checks: { app: 'up' } };
  }

  @Get('ready')
  ready(): { status: string; checks: Record<string, string> } {
    // Sprint 01: app readiness only. Sprint 02 adds db/redis checks.
    return { status: 'ok', checks: { app: 'up', db: 'not-configured' } };
  }
}
