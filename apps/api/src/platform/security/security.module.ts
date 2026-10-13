import { Global, Module } from '@nestjs/common';
import { HttpProblemFilter } from '../common/filters/http-problem.filter.js';
import { SecurityEventService } from './security-event.service.js';

/**
 * Global platform security plumbing (EPIC-22): the append-only security
 * event writer used by the HTTP problem filter, break-glass service and the
 * security module's SIEM feed.
 */
@Global()
@Module({
  providers: [SecurityEventService, HttpProblemFilter],
  exports: [SecurityEventService, HttpProblemFilter],
})
export class PlatformSecurityModule {}
