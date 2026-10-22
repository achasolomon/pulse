import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  OUTPATIENT_REPOSITORY,
  type OutpatientRepository,
} from '../domain/outpatient.repository.js';
class KeyDto {
  @IsUUID() commandKey!: string;
}
class CheckInDto extends KeyDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() appointmentId?: string;
}
class HandoffDto extends KeyDto {
  @IsUUID() clinicianId!: string;
}
@Controller('staff/visits')
@UseGuards(StaffPatientReadGuard)
export class OutpatientController {
  constructor(
    @Inject(OUTPATIENT_REPOSITORY) private readonly repo: OutpatientRepository,
  ) {}
  private require(req: PatientReadRequest, ...privileges: string[]) {
    if (!privileges.every((p) => req.patientReadScope.privileges.includes(p)))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'This action is not available for your account',
      });
    return req.patientReadScope;
  }
  @Get() @Header('Cache-Control', 'no-store') list(
    @Req() req: PatientReadRequest,
    @Query('queue') queue = 'reception',
  ) {
    if (!['reception', 'vitals', 'consultation'].includes(queue))
      throw new BadRequestException({ message: 'Select a valid worklist' });
    const scope = this.require(
      req,
      'encounter:read',
      queue === 'reception'
        ? 'appointment:read'
        : queue === 'vitals'
          ? 'observation:write'
          : 'encounter:consult',
    );
    return this.repo.list(
      scope,
      queue as 'reception' | 'vitals' | 'consultation',
    );
  }
  @Get('clinicians') @Header('Cache-Control', 'no-store') clinicians(
    @Req() req: PatientReadRequest,
  ) {
    return this.repo.clinicians(this.require(req, 'observation:write'));
  }
  @Get('patient/:id') @Header('Cache-Control', 'no-store') current(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.repo.current(this.require(req, 'encounter:read'), id);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') get(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.repo.get(this.require(req, 'encounter:read'), id);
  }
  @Post('check-in') checkIn(
    @Req() req: PatientReadRequest,
    @Body() input: CheckInDto,
  ) {
    return this.repo.checkIn(
      this.require(req, 'appointment:check-in', 'encounter:write'),
      input,
    );
  }
  @Post(':id/claim') claim(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: KeyDto,
  ) {
    return this.repo.move(
      this.require(req, 'observation:write'),
      id,
      'claim',
      input.commandKey,
    );
  }
  @Post(':id/handoff') handoff(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: HandoffDto,
  ) {
    return this.repo.move(
      this.require(req, 'observation:write'),
      id,
      'handoff',
      input.commandKey,
      input.clinicianId,
    );
  }
  @Post(':id/start') start(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: KeyDto,
  ) {
    return this.repo.move(
      this.require(req, 'encounter:consult'),
      id,
      'start',
      input.commandKey,
    );
  }
}
