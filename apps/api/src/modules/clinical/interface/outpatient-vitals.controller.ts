import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { VitalMeasurement } from '@pulse/api-contracts';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  OUTPATIENT_VITALS_REPOSITORY,
  type OutpatientVitalsRepository,
} from '../domain/outpatient-vitals.repository.js';
class MeasurementDto implements VitalMeasurement {
  @IsIn([
    'heart-rate',
    'respiratory-rate',
    'temperature',
    'spo2',
    'bp-systolic',
    'bp-diastolic',
    'weight',
    'height',
  ])
  code!: VitalMeasurement['code'];
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(10000)
  value!: number;
}
class VitalsDto {
  @IsUUID() commandKey!: string;
  @IsDateString() takenAt!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements!: MeasurementDto[];
}
@Controller('staff/visits')
@UseGuards(StaffPatientReadGuard)
export class OutpatientVitalsController {
  constructor(
    @Inject(OUTPATIENT_VITALS_REPOSITORY)
    private readonly repo: OutpatientVitalsRepository,
  ) {}
  @Post(':id/vitals') record(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: VitalsDto,
  ) {
    if (!req.patientReadScope.privileges.includes('observation:write'))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You cannot record vitals in this facility',
      });
    const codes = input.measurements.map((m) => m.code);
    if (
      new Set(codes).size !== codes.length ||
      codes.includes('bp-systolic') !== codes.includes('bp-diastolic') ||
      input.measurements.some((m) => m.code === 'spo2' && m.value > 100) ||
      Date.parse(input.takenAt) > Date.now() + 60000
    )
      throw new BadRequestException({
        code: 'VITALS_INVALID',
        message:
          'Enter each measurement once, pair both blood-pressure values and check the recorded time',
      });
    return this.repo.record(req.patientReadScope, id, input);
  }
}
