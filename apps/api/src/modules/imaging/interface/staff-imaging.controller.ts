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
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  STAFF_IMAGING_REPOSITORY,
  type StaffImagingRepository,
} from '../domain/staff-imaging.repository.js';
class OrderDto {
  @IsUUID() encounterId!: string;
  @IsIn(['left', 'right', 'bilateral', 'na']) laterality!:
    'left' | 'right' | 'bilateral' | 'na';
  @IsString() @Length(0, 2000) safetyContext!: string;
  @IsUUID() procedureId!: string;
  @IsInt() @Min(1) procedureVersion!: number;
  @IsIn(['routine', 'urgent', 'stat']) urgency!: 'routine' | 'urgent' | 'stat';
  @IsString() @Length(3, 2000) @Matches(/\S/) indication!: string;
  @IsUUID() commandKey!: string;
  @Equals(true) attestation!: true;
}
class CancelDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(3, 1000) @Matches(/\S/) reason!: string;
  @IsUUID() commandKey!: string;
}
@Controller('staff/patients/:patientId/imaging')
@UseGuards(StaffPatientReadGuard)
export class StaffImagingController {
  constructor(
    @Inject(STAFF_IMAGING_REPOSITORY)
    private readonly imaging: StaffImagingRepository,
  ) {}
  @Get('catalogue') @Header('Cache-Control', 'no-store') catalogue(
    @Req() req: PatientReadRequest,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Query('q') q?: string,
  ) {
    return this.imaging.catalogue(req.patientReadScope, patientId, q ?? '');
  }
  @Get('contexts') @Header('Cache-Control', 'no-store') contexts(
    @Req() req: PatientReadRequest,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
  ) {
    return this.imaging.contexts(req.patientReadScope, patientId);
  }
  @Get('orders/:id') @Header('Cache-Control', 'no-store') get(
    @Req() req: PatientReadRequest,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.imaging.get(req.patientReadScope, patientId, id);
  }
  @Post('orders') order(
    @Req() req: PatientReadRequest,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Body() input: OrderDto,
  ) {
    return this.imaging.order(req.patientReadScope, patientId, input);
  }
  @Post('orders/:id/cancel') cancel(
    @Req() req: PatientReadRequest,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CancelDto,
  ) {
    return this.imaging.cancel(req.patientReadScope, patientId, id, input);
  }
}
