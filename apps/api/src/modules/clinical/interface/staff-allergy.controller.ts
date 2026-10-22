import {Body,Controller,Get,Header,Inject,Param,ParseUUIDPipe,Post,Req,UseGuards} from '@nestjs/common';
import {Equals,IsIn,IsString,IsUUID,Length,Matches} from 'class-validator';
import type {StaffAllergyInput,AllergyInformationSource,AllergyReviewStatus} from '@pulse/api-contracts';
import {StaffPatientReadGuard,type PatientReadRequest} from '../../patient/interface/staff-patient-read.controller.js';
import {STAFF_ALLERGY_REPOSITORY,type StaffAllergyRepository} from '../domain/staff-allergy.repository.js';
class CommandDto {
  @IsUUID() encounterId!:string;
  @IsUUID() commandKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedRevision!:string;
}
class AddDto extends CommandDto implements StaffAllergyInput {
  @IsString() @Length(3,300) @Matches(/\S/) substance!:string;
  @IsIn(['medication','food','environment','other','unknown']) category!:StaffAllergyInput['category'];
  @IsIn(['allergy','intolerance','unknown']) type!:StaffAllergyInput['type'];
  @IsString() @Length(3,2000) @Matches(/\S/) reaction!:string;
  @IsIn(['mild','moderate','severe','unknown']) severity!:StaffAllergyInput['severity'];
  @IsIn(['low','high','unable-to-assess']) criticality!:StaffAllergyInput['criticality'];
  @IsIn(['patient','carer','clinical-record','clinician']) informationSource!:AllergyInformationSource;
  @IsIn(['provisional','confirmed']) verificationStatus!:StaffAllergyInput['verificationStatus'];
}
class ReviewDto extends CommandDto {
  @IsIn(['unknown','no-known-allergies','no-known-drug-allergies']) status!:AllergyReviewStatus;
  @IsIn(['patient','carer','clinical-record','clinician']) informationSource!:AllergyInformationSource;
  @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
  @Equals(true) attestation!:true;
}
class CorrectionDto extends CommandDto {
  @IsString() @Length(3,2000) @Matches(/\S/) reason!:string;
}
@Controller('staff/patients/:patientId/allergies') @UseGuards(StaffPatientReadGuard)
export class StaffAllergyController {
  constructor(@Inject(STAFF_ALLERGY_REPOSITORY) private readonly allergies:StaffAllergyRepository){}
  @Get() @Header('Cache-Control','no-store') read(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) id:string){return this.allergies.read(req.patientReadScope,id);}
  @Post() add(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) id:string,@Body() input:AddDto){return this.allergies.add(req.patientReadScope,id,input);}
  @Post('review') review(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) id:string,@Body() input:ReviewDto){return this.allergies.review(req.patientReadScope,id,input);}
  @Post(':id/entered-in-error') correct(@Req() req:PatientReadRequest,@Param('patientId',new ParseUUIDPipe()) patientId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() input:CorrectionDto){return this.allergies.correct(req.patientReadScope,patientId,id,input);}
}
