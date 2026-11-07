import {Body,Controller,Get,Header,Inject,Param,ParseUUIDPipe,Post,Query,Req,UseGuards} from '@nestjs/common';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,Equals,IsArray,IsIn,IsInt,IsObject,IsString,IsUUID,Length,Matches,Min,ValidateIf} from 'class-validator';
import type {StaffImagingProtocolInput} from '@pulse/api-contracts';
import {StaffPatientReadGuard,type PatientReadRequest} from '../../patient/interface/staff-patient-read.controller.js';
import {STAFF_IMAGING_REPOSITORY,type StaffImagingRepository} from '../domain/staff-imaging.repository.js';
import {PacsConnectionService} from '../application/pacs-connection.service.js';
import {StaffAcquisitionService} from '../application/staff-acquisition.service.js';
import {StaffReportingService} from '../application/staff-reporting.service.js';
class ReportDraftDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @ValidateIf((_o,v)=>v!==null) @IsUUID() expectedReportId!:string|null;
 @IsUUID() studyId!:string;
 @IsObject() content!:import('@pulse/api-contracts').StaffImagingReportContent;
 @IsIn(['routine','urgent','critical']) priority!:'routine'|'urgent'|'critical';
 @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
 @IsUUID() commandKey!:string;
}
class ReportSignDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() reportId!:string;
 @IsString() @Length(3,500) @Matches(/\S/) reviewReference!:string;
 @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class AcquisitionConfirmDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class AcquisitionPrepareDto extends AcquisitionConfirmDto {
 @IsUUID() templateId!:string;
 @IsInt() @Min(1) templateVersion!:number;
 @IsObject() responses!:StaffImagingProtocolInput['responses'];
}
class ProtocolDto implements StaffImagingProtocolInput {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() templateId!:string;
 @IsInt() @Min(1) templateVersion!:number;
 @IsIn(['hold','approved']) decision!:'hold'|'approved';
 @IsObject() responses!:StaffImagingProtocolInput['responses'];
 @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class ScheduleDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() slotId!:string;
 @IsString() @Length(3,1000) @Matches(/\S/) reason!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class BookingChangeDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() bookingId!:string;
 @IsString() @Length(3,1000) @Matches(/\S/) reason!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
class RescheduleDto extends BookingChangeDto { @IsUUID() slotId!:string; }
class ArrivalDto {
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() bookingId!:string;
 @IsArray() @ArrayMinSize(2) @ArrayMaxSize(3) @ArrayUnique() @IsIn(['full-name','date-of-birth','mrn'],{each:true}) identifierMethods!:('full-name'|'date-of-birth'|'mrn')[];
 @IsString() @Length(0,1000) note!:string;
 @Equals(true) attestation!:true;
 @IsUUID() commandKey!:string;
}
@Controller('staff/radiology') @UseGuards(StaffPatientReadGuard)
export class StaffRadiologyController {
 constructor(@Inject(STAFF_IMAGING_REPOSITORY) private readonly imaging:StaffImagingRepository,private readonly pacs:PacsConnectionService,private readonly acquisition:StaffAcquisitionService,private readonly reporting:StaffReportingService){}
 @Get('orders/:id/reports') @Header('Cache-Control','no-store') reports(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.reporting.get(req.patientReadScope,id);}
 @Post('orders/:id/report-drafts') draftReport(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ReportDraftDto){return this.reporting.save(req.patientReadScope,id,input);}
 @Post('orders/:id/report-signoff') signReport(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ReportSignDto){return this.reporting.sign(req.patientReadScope,id,input);}
 @Get('orders/:id/acquisition') @Header('Cache-Control','no-store') acquisitionGet(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.acquisition.get(req.patientReadScope,id);}
 @Post('orders/:id/acquisition-prepare') acquisitionPrepare(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:AcquisitionPrepareDto){return this.acquisition.prepare(req.patientReadScope,id,input);}
 @Post('orders/:id/acquisition-confirm') acquisitionConfirm(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:AcquisitionConfirmDto){return this.acquisition.confirm(req.patientReadScope,id,input);}
 @Get('pacs/status') @Header('Cache-Control','no-store') pacsStatus(@Req() req:PatientReadRequest){return this.pacs.status(req.patientReadScope);}
 @Get('queue') @Header('Cache-Control','no-store') queue(@Req() req:PatientReadRequest,@Query('status') status?:string,@Query('q') q?:string,@Query('cursor') cursor?:string){return this.imaging.queue(req.patientReadScope,status??'all',q??'',cursor);}
 @Get('orders/:id') @Header('Cache-Control','no-store') get(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.imaging.dutyGet(req.patientReadScope,id);}
 @Get('orders/:id/protocols') @Header('Cache-Control','no-store') protocols(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.imaging.protocols(req.patientReadScope,id);}
 @Post('orders/:id/protocol-reviews') review(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ProtocolDto){return this.imaging.reviewProtocol(req.patientReadScope,id,input);}
 @Get('orders/:id/slots') @Header('Cache-Control','no-store') slots(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Query('from') from?:string,@Query('to') to?:string){return this.imaging.slots(req.patientReadScope,id,from??'',to??'');}
 @Post('orders/:id/schedule') schedule(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ScheduleDto){return this.imaging.schedule(req.patientReadScope,id,input);}
 @Post('orders/:id/reschedule') reschedule(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:RescheduleDto){return this.imaging.changeBooking(req.patientReadScope,id,input,'rescheduled');}
 @Post('orders/:id/appointment-cancel') cancelAppointment(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:BookingChangeDto){return this.imaging.changeBooking(req.patientReadScope,id,input,'cancelled');}
 @Post('orders/:id/no-show') noShow(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:BookingChangeDto){return this.imaging.changeBooking(req.patientReadScope,id,input,'no-show');}
 @Post('orders/:id/arrive') arrive(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ArrivalDto){return this.imaging.arrive(req.patientReadScope,id,input);}
 @Get('orders/:id/readiness') @Header('Cache-Control','no-store') readiness(@Req() req:PatientReadRequest,@Param('id',new ParseUUIDPipe()) id:string){return this.imaging.readiness(req.patientReadScope,id);}
}
