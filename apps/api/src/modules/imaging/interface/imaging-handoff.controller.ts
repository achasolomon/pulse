import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req,UseGuards} from '@nestjs/common';
import {Equals,IsBoolean,IsIn,IsInt,IsISO8601,IsString,IsUUID,Length,Min} from 'class-validator';
import {StaffPatientReadGuard,type PatientReadRequest} from '../../patient/interface/staff-patient-read.controller.js';
import {ImagingHandoffService} from '../application/imaging-handoff.service.js';
class HandoffDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() reportId!:string;
 @IsUUID() recipientId!:string;
 @IsISO8601({strict:true}) dueAt!:string;
 @IsString() @Length(3,500) policyReference!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class AckDto {
 @IsInt() @Min(1) expectedCaseVersion!:number;
 @IsString() @Length(3,2000) note!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class ContactDto extends AckDto {
 @IsIn(['phone','in-person']) channel!:'phone'|'in-person';
 @IsIn(['reached','unreachable']) outcome!:'reached'|'unreachable';
 @IsBoolean() readBack!:boolean;
 @IsISO8601({strict:true}) occurredAt!:string;
}
@Controller('staff/imaging-handoffs') @UseGuards(StaffPatientReadGuard)
export class ImagingHandoffController {
 constructor(private readonly service:ImagingHandoffService){}
 @Get('count') @Header('Cache-Control','no-store') count(@Req() r:PatientReadRequest){return this.service.count(r.patientReadScope);}
 @Get('queue') @Header('Cache-Control','no-store') queue(@Req() r:PatientReadRequest,@Query('cursor') cursor?:string){return this.service.queue(r.patientReadScope,cursor);}
 @Get('orders/:id') @Header('Cache-Control','no-store') get(@Req() r:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.service.get(r.patientReadScope,id);}
 @Get('orders/:id/recipients') @Header('Cache-Control','no-store') recipients(@Req() r:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.service.recipients(r.patientReadScope,id);}
 @Post('orders/:id/start') create(@Req() r:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:HandoffDto){return this.service.create(r.patientReadScope,id,input);}
 @Post('orders/:id/contact') contact(@Req() r:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ContactDto){return this.service.contact(r.patientReadScope,id,input);}
 @Post('orders/:id/acknowledge') acknowledge(@Req() r:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:AckDto){return this.service.acknowledge(r.patientReadScope,id,input);}
}
