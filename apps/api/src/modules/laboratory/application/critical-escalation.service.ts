import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  STAFF_CRITICAL_REPOSITORY,
  type StaffCriticalRepository,
} from '../domain/staff-critical.repository.js';
@Injectable()
export class CriticalEscalationService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(CriticalEscalationService.name);
  constructor(
    @Inject(STAFF_CRITICAL_REPOSITORY)
    private readonly repo: StaffCriticalRepository,
  ) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    this.timer = setInterval(() => void this.process(), 5000);
    this.timer.unref();
    void this.process();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async process() {
    if (this.running) return;
    this.running = true;
    try {
      return await this.repo.processDue();
    } catch {
      this.logger.warn(
        'Critical backup processing unavailable; pending routing remains durable.',
      );
    } finally {
      this.running = false;
    }
  }
}
