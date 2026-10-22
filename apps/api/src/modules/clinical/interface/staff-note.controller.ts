import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  Header,
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
  IsOptional,
  IsObject,
} from 'class-validator';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  STAFF_NOTE_REPOSITORY,
  type StaffNoteRepository,
} from '../domain/staff-note.repository.js';
class ContentDto {
  @IsOptional() @IsObject() richText?: import('@pulse/api-contracts').NoteFormatting;
  @IsString() @Length(1, 2000) @Matches(/\S/) chiefComplaint!: string;
  @IsString() @Length(0, 10000) history!: string;
  @IsString() @Length(0, 10000) examination!: string;
  @IsString() @Length(0, 10000) assessment!: string;
  @IsString() @Length(0, 10000) plan!: string;
  @IsUUID() commandKey!: string;
}
class CreateDto extends ContentDto {
  @IsUUID() encounterId!: string;
  @IsIn(['consultation', 'nursing']) kind!: 'consultation' | 'nursing';
}
class UpdateDto extends ContentDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
class SignDto {
  @IsUUID() commandKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @Equals(true) attestation!: boolean;
}
class AmendDto {
  @IsUUID() commandKey!: string;
  @IsString() @Length(3, 4000) @Matches(/\S/) text!: string;
}
@Controller('staff')
@UseGuards(StaffPatientReadGuard)
export class StaffNoteController {
  constructor(
    @Inject(STAFF_NOTE_REPOSITORY) private readonly notes: StaffNoteRepository,
  ) {}
  @Get('patients/:id/note-contexts')
  @Header('Cache-Control', 'no-store')
  contexts(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notes.contexts(req.patientReadScope, id);
  }
  @Get('notes/:id') @Header('Cache-Control', 'no-store') get(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notes.get(req.patientReadScope, id);
  }
  @Post('patients/:id/notes') create(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateDto,
  ) {
    return this.notes.save(req.patientReadScope, id, input);
  }
  @Post('notes/:id/save') save(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateDto,
  ) {
    return this.notes.update(req.patientReadScope, id, input);
  }
  @Post('notes/:id/sign') sign(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SignDto,
  ) {
    return this.notes.sign(req.patientReadScope, id, input);
  }
  @Post('notes/:id/addenda') amend(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AmendDto,
  ) {
    return this.notes.amend(req.patientReadScope, id, input);
  }
}
