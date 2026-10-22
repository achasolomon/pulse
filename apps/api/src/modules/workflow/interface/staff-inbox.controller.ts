import {
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { StaffInboxService } from '../application/staff-inbox.service.js';
type ScopedRequest = Request & {
  inboxScope: Awaited<ReturnType<StaffInboxService['scope']>>;
};
@Injectable()
export class StaffInboxGuard implements CanActivate {
  constructor(private readonly inbox: StaffInboxService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ScopedRequest>();
    req.inboxScope = await this.inbox.scope(
      req.headers.authorization,
      typeof req.headers['x-facility-id'] === 'string'
        ? req.headers['x-facility-id']
        : undefined,
      typeof req.headers['x-tenant-id'] === 'string'
        ? req.headers['x-tenant-id']
        : undefined,
    );
    return true;
  }
}
class AssignedTaskDto {
  @IsString() @Length(1, 160) @Matches(/\S/) kind!: string;
  @IsUUID() assigneeId!: string;
}
@Controller('workflow/staff')
@UseGuards(StaffInboxGuard)
export class StaffInboxController {
  constructor(private readonly inbox: StaffInboxService) {}
  @Get('notifications')
  @Header('Cache-Control', 'no-store')
  list(
    @Req() req: ScopedRequest,
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.list(req.inboxScope, unread === 'true', cursor);
  }
  @Post('notifications/:id/read')
  read(
    @Req() req: ScopedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.inbox.read(req.inboxScope, id);
  }
  @Get('tasks/:id')
  @Header('Cache-Control', 'no-store')
  task(
    @Req() req: ScopedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.inbox.task(req.inboxScope, id);
  }
  @Post('tasks')
  create(@Req() req: ScopedRequest, @Body() body: AssignedTaskDto) {
    return this.inbox.create(req.inboxScope, body);
  }
}
