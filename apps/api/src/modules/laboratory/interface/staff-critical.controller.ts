import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsUUID,
  Matches,
  Min,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  STAFF_CRITICAL_REPOSITORY,
  type StaffCriticalRepository,
} from '../domain/staff-critical.repository.js';
class VersionDto {
  @IsUUID() commandKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
class AckDto extends VersionDto {
  @Equals(true) attestation!: true;
}
class NotifyDto extends AckDto {
  @IsUUID() recipientId!: string;
  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) dueAt!: string;
}
class AttemptDto extends VersionDto {
  @IsOptional() @IsUUID() recipientId?: string;
  @IsIn(['phone', 'in-person']) channel!: 'phone' | 'in-person';
  @IsIn(['reached', 'unreachable']) outcome!: 'reached' | 'unreachable';
  @IsBoolean() readBack!: boolean;
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d\d:\d\d)$/)
  occurredAt!: string;
}
class BackupDto extends AckDto {
  @IsUUID() recipientId!: string;
  @IsIn(['immediate', 'at-deadline']) mode!: 'immediate' | 'at-deadline';
  @IsString() @Length(5, 1000) @Matches(/\S/) reason!: string;
}
@Controller('staff/critical-results')
@UseGuards(StaffPatientReadGuard)
export class StaffCriticalController {
  @Post('orders/:id/backup') backup(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: BackupDto,
  ) {
    return this.repo.backup(r.patientReadScope, id, input);
  }
  constructor(
    @Inject(STAFF_CRITICAL_REPOSITORY)
    private readonly repo: StaffCriticalRepository,
  ) {}
  @Get() @Header('Cache-Control', 'no-store') queue(
    @Req() r: PatientReadRequest,
    @Query('cursor') cursor?: string,
  ) {
    return this.repo.queue(r.patientReadScope, cursor);
  }
  @Get('count') @Header('Cache-Control', 'no-store') count(
    @Req() r: PatientReadRequest,
  ) {
    return this.repo.count(r.patientReadScope);
  }
  @Get('orders/:id') @Header('Cache-Control', 'no-store') get(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.repo.get(r.patientReadScope, id);
  }
  @Get('orders/:id/recipients') @Header('Cache-Control', 'no-store') recipients(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.repo.recipients(r.patientReadScope, id);
  }
  @Post('orders/:id/notify') notify(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: NotifyDto,
  ) {
    return this.repo.notify(r.patientReadScope, id, input);
  }
  @Post('orders/:id/attempt') attempt(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AttemptDto,
  ) {
    return this.repo.attempt(r.patientReadScope, id, input);
  }
  @Post('orders/:id/acknowledge') acknowledge(
    @Req() r: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AckDto,
  ) {
    return this.repo.acknowledge(r.patientReadScope, id, input);
  }
}
