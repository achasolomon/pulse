import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from './staff-patient-read.controller.js';
import {
  STAFF_REGISTRATION_REPOSITORY,
  type StaffRegistrationRepository,
} from '../domain/staff-registration.repository.js';
class StaffRegisterDto {
  @IsString() @Length(1, 120) @Matches(/\S/) givenName!: string;
  @IsString() @Length(1, 120) @Matches(/\S/) familyName!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth!: string;
  @IsIn(['M', 'F', 'O', 'U']) sex!: 'M' | 'F' | 'O' | 'U';
  @IsOptional() @IsString() @Length(1, 40) phone?: string;
  @IsOptional() @IsString() @Length(1, 300) address?: string;
  @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
  @IsUUID() commandKey!: string;
}
@Controller('staff/patients')
@UseGuards(StaffPatientReadGuard)
export class StaffRegistrationController {
  constructor(
    @Inject(STAFF_REGISTRATION_REPOSITORY)
    private readonly repo: StaffRegistrationRepository,
  ) {}
  @Post('register') register(
    @Req() req: PatientReadRequest,
    @Body() input: StaffRegisterDto,
  ) {
    if (!req.patientReadScope.privileges.includes('patient:write'))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You cannot register patients in this facility',
      });
    const date = new Date(input.dateOfBirth + 'T00:00:00Z');
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.dateOfBirth ||
      input.dateOfBirth > new Date().toISOString().slice(0, 10)
    )
      throw new BadRequestException({
        code: 'PATIENT_DOB_INVALID',
        message: 'Enter a valid date of birth that is not in the future',
      });
    return this.repo.register(req.patientReadScope, {
      dateOfBirth: input.dateOfBirth,
      sex: input.sex,
      phone: input.phone,
      address: input.address,
      confirmDuplicate: input.confirmDuplicate,
      commandKey: input.commandKey,
      givenName: input.givenName.trim(),
      familyName: input.familyName.trim(),
    });
  }
}
