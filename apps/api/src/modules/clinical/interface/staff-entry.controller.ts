import {Body,Controller,Get,Header,Inject,Param,ParseUUIDPipe,Post,Req,UseGuards} from '@nestjs/common';
import {IsIn,IsInt,IsString,IsUUID,Length,Matches,Min} from 'class-validator';
import {StaffPatientReadGuard,type PatientReadRequest} from '../../patient/interface/staff-patient-read.controller.js';
import {STAFF_ENTRY_REPOSITORY,type StaffEntryRepository} from '../domain/staff-entry.repository.js';
class EntryDto {
  @IsUUID() encounterId!: string;
  @IsUUID() commandKey!: string;
  @IsIn(['problem','diagnosis']) kind!: 'problem'|'diagnosis';
  @IsIn(['provisional','confirmed','differential']) verificationStatus!: 'provisional'|'confirmed'|'differential';
  @IsString() @Length(3,300) @Matches(/\S/) display!: string;
}
class ResolveDto {
  @IsUUID() encounterId!: string;
  @IsUUID() commandKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(3,2000) @Matches(/\S/) reason!: string;
}
@Controller('staff/patients/:patientId')
@UseGuards(StaffPatientReadGuard)
export class StaffEntryController {
  constructor(@Inject(STAFF_ENTRY_REPOSITORY) private readonly entries: StaffEntryRepository) {}
  @Get('problem-contexts') @Header('Cache-Control','no-store') contexts(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) patientId:string) { return this.entries.contexts(req.patientReadScope,patientId); }
  @Get('problems/:id') @Header('Cache-Control','no-store') get(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) patientId:string,@Param('id',new ParseUUIDPipe()) id:string) { return this.entries.get(req.patientReadScope,patientId,id); }
  @Post('problems') create(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) patientId:string,@Body() input:EntryDto) { return this.entries.create(req.patientReadScope,patientId,input); }
  @Post('problems/:id/resolve') resolve(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) patientId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ResolveDto) { return this.entries.resolve(req.patientReadScope,patientId,id,input); }
}
