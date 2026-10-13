import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class BookAppointmentDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  facilityId!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class RescheduleDto {
  @IsDateString()
  scheduledAt!: string;
}
