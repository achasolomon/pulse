import {
  Controller,
  Get,
  Header,
  Injectable,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { StaffPatientReadService } from '../application/staff-patient-read.service.js';
export type PatientReadRequest = Request & {
  patientReadScope: Awaited<ReturnType<StaffPatientReadService['scope']>>;
};
@Injectable()
export class StaffPatientReadGuard implements CanActivate {
  constructor(private readonly patients: StaffPatientReadService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<PatientReadRequest>();
    req.patientReadScope = await this.patients.scope(
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
@Controller('staff/patients')
@UseGuards(StaffPatientReadGuard)
export class StaffPatientReadController {
  constructor(private readonly patients: StaffPatientReadService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() req: PatientReadRequest,
    @Query('q') query?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.patients.list(req.patientReadScope, query, status, cursor);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  identity(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.patients.identity(req.patientReadScope, id);
  }
}
