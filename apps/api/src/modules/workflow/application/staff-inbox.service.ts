import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { StaffContextService } from '../../iam/application/staff-context.service.js';
import {
  STAFF_INBOX_REPOSITORY,
  type InboxScope,
  type StaffInboxRepository,
} from '../domain/staff-inbox.repository.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class StaffInboxService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(StaffInboxService.name);
  constructor(
    private readonly staff: StaffContextService,
    @Inject(STAFF_INBOX_REPOSITORY) private readonly repo: StaffInboxRepository,
  ) {}
  async scope(
    authorization?: string,
    facilityId?: string,
    organizationId?: string,
  ) {
    const actor = await this.staff.self(authorization);
    const membership = actor.facilities.find(
      (f) => f.facilityId === facilityId && f.organizationId === organizationId,
    );
    if (!membership)
      throw new ForbiddenException({
        code: 'INBOX_SCOPE_DENIED',
        message: 'Select a facility you can access',
      });
    return {
      personId: actor.personId,
      facilityId: membership.facilityId,
      organizationId: membership.organizationId,
      privileges: membership.privileges,
    };
  }
  list(scope: InboxScope, unread: boolean, cursor?: string) {
    if (cursor) {
      try {
        if (cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor))
          throw new Error();
        const parsed = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        ) as { at?: unknown; id?: unknown };
        if (
          typeof parsed.at !== 'string' ||
          !Number.isFinite(Date.parse(parsed.at)) ||
          typeof parsed.id !== 'string' ||
          !UUID.test(parsed.id)
        )
          throw new Error();
      } catch {
        throw new BadRequestException({
          code: 'INBOX_CURSOR_INVALID',
          message: 'Invalid inbox page',
        });
      }
    }
    return this.repo.list(scope, unread, cursor);
  }
  async read(scope: InboxScope, id: string) {
    if (!(await this.repo.read(scope, id)))
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification is unavailable',
      });
    return { read: true };
  }
  async task(scope: InboxScope, id: string) {
    const task = await this.repo.task(scope, id);
    if (!task)
      throw new NotFoundException({
        code: 'TASK_NOT_FOUND',
        message: 'Task is unavailable',
      });
    return task;
  }
  create(
    scope: InboxScope & { privileges: string[] },
    input: { kind: string; assigneeId: string },
  ) {
    if (!scope.privileges.includes('task:create'))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You cannot assign tasks in this facility',
      });
    return this.repo.createAssigned(scope, {
      ...input,
      kind: input.kind.trim(),
    });
  }
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    this.timer = setInterval(() => {
      void this.deliver();
    }, 5000);
    this.timer.unref();
    void this.deliver();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async deliver() {
    if (this.running) return;
    this.running = true;
    try {
      return await this.repo.deliverBatch();
    } catch {
      this.logger.warn(
        'Staff notification delivery failed; pending events retained for retry',
      );
    } finally {
      this.running = false;
    }
  }
}
