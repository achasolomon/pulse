import { Inject, Injectable } from '@nestjs/common';
import {
  SECURITY_EVENT_REPOSITORY,
  decodeSecurityCursor,
  encodeSecurityCursor,
  type SecurityEventRepository,
} from '../domain/security-event.repository.js';

export const AUTH_FAILURE_THRESHOLD = 10;
export const AUTH_FAILURE_WINDOW_MS = 15 * 60_000;
export const PATIENT_TOUCH_THRESHOLD = 25;
export const PATIENT_TOUCH_WINDOW_MS = 15 * 60_000;

/**
 * SIEM feed + detection catalogue (SEC-001 sections 60-61). SOC collectors
 * page the cursor feed; detectors implement the first two detection use
 * cases (repeated credential rejection, mass patient-record activity) with
 * severity/owner mapping in the runbook.
 */
@Injectable()
export class SiemService {
  constructor(
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly repo: SecurityEventRepository,
  ) {}

  feed(
    cursorRaw: string,
    limit: number,
    filter?: { severity?: string; category?: string },
  ) {
    const since = cursorRaw ? decodeSecurityCursor(cursorRaw) : {};
    return this.repo.feed(since, limit, filter).then(({ events, cursor }) => ({
      events,
      cursor: encodeSecurityCursor(cursor),
    }));
  }

  async detections(now: Date = new Date()) {
    const [repeatedAuthFailures, massPatientTouches] = await Promise.all([
      this.repo.repeatedAuthFailures({
        since: new Date(now.getTime() - AUTH_FAILURE_WINDOW_MS),
        threshold: AUTH_FAILURE_THRESHOLD,
      }),
      this.repo.massPatientTouches({
        since: new Date(now.getTime() - PATIENT_TOUCH_WINDOW_MS),
        threshold: PATIENT_TOUCH_THRESHOLD,
      }),
    ]);
    return {
      windowMinutes: 15,
      repeatedAuthFailures,
      massPatientTouches,
    };
  }
}
