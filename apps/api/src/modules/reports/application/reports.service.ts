import { Inject, Injectable } from '@nestjs/common';
import {
  REPORTS_REPOSITORY,
  type ReportsRepository,
} from '../domain/reports.repository.js';

/** Reports application service (EPIC-20 baseline). Read-only. */
@Injectable()
export class ReportsService {
  constructor(@Inject(REPORTS_REPOSITORY) private readonly repo: ReportsRepository) {}

  census(facilityId: string) {
    return this.repo.census(facilityId);
  }

  revenue(facilityId: string, from: string, to: string) {
    return this.repo.revenue(facilityId, from, to);
  }

  claims(facilityId: string) {
    return this.repo.claimAging(facilityId);
  }
}
