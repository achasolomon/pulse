import {Body,Controller,Get,Header,Inject,Param,ParseUUIDPipe,Post,Query,Req,UseGuards} from '@nestjs/common';
import {Equals,IsISO8601,IsInt,IsString,IsUUID,Length,Matches,Min,IsIn,ValidateIf} from 'class-validator';
import {StaffPatientReadGuard,type PatientReadRequest} from '../../patient/interface/staff-patient-read.controller.js';
import {STAFF_LAB_WORKFLOW_REPOSITORY,type StaffLabWorkflowRepository} from '../domain/staff-lab-workflow.repository.js';
class VerificationDto {
  @IsUUID() commandKey!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @Equals(true) attestation!:true;
}
class ResultDto extends VerificationDto {
  @IsString() @Length(1,100) @Matches(/\S/) component!:string;
  @IsString() @Length(1,2000) @Matches(/\S/) value!:string;
  @IsString() @Length(0,50) unit!:string;
  @ValidateIf((_o,v)=>v!==null) @IsIn(['normal','high','low','critical']) flag!:'normal'|'high'|'low'|'critical'|null;
  @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) effectiveAt!:string;
}
class CollectionDto {
  @IsUUID() commandKey!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @IsString() @Length(3,100) @Matches(/\S/) container!:string;
  @IsString() @Length(3,100) @Matches(/\S/) label!:string;
  @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) collectedAt!:string;
  @Equals(true) identityConfirmed!:true;
}
class AccessionDto {
  @IsUUID() commandKey!:string;
  @IsInt() @Min(1) expectedVersion!:number;
  @IsUUID() specimenId!:string;
  @IsString() @Length(3,100) @Matches(/\S/) accessionNumber!:string;
  @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) receivedAt!:string;
  @Equals(true) identityConfirmed!:true;
}
@Controller('staff/laboratory') @UseGuards(StaffPatientReadGuard)
export class StaffLabWorkflowController {
  constructor(@Inject(STAFF_LAB_WORKFLOW_REPOSITORY) private readonly lab:StaffLabWorkflowRepository){}
  @Get('queue') @Header('Cache-Control','no-store') queue(@Req() req:PatientReadRequest,@Query('status') status?:string,@Query('q') q?:string,@Query('cursor') cursor?:string){return this.lab.queue(req.patientReadScope,status??'all',q??'',cursor);}
  @Get('orders/:id') @Header('Cache-Control','no-store') get(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.lab.get(req.patientReadScope,id);}
  @Post('orders/:id/collect') collect(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:CollectionDto){return this.lab.collect(req.patientReadScope,id,input);}
  @Post('orders/:id/accession') accession(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:AccessionDto){return this.lab.accession(req.patientReadScope,id,input);}
  @Post('orders/:id/results') result(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ResultDto){return this.lab.result(req.patientReadScope,id,input);}
  @Post('orders/:id/verify') verify(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:VerificationDto){return this.lab.verify(req.patientReadScope,id,input);}
}
