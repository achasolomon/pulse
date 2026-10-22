import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ClinicalService } from '../application/clinical.service.js';
import { StaffPatientReadService } from '../../patient/application/staff-patient-read.service.js';
import {
  ENCOUNTER_REPOSITORY,
  type EncounterRepository,
} from '../../encounter/domain/encounter.repository.js';
import {
  OUTPATIENT_REPOSITORY,
  type OutpatientRepository,
} from '../../encounter/domain/outpatient.repository.js';
import {
  CLINICAL_REPOSITORY,
  type ClinicalRepository,
} from '../domain/clinical.repository.js';
import {
  AddendumDto,
  DraftNoteDto,
  RecordEntryDto,
  RecordVitalsDto,
} from './dto.js';

/** Clinical endpoints (EPIC-07 triage/vitals, EPIC-08 notes/problems). */
@Controller('clinical')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ClinicalController {
  constructor(
    private readonly clinical: ClinicalService,
    private readonly patients: StaffPatientReadService,
    @Inject(ENCOUNTER_REPOSITORY)
    private readonly encounters: EncounterRepository,
    @Inject(OUTPATIENT_REPOSITORY)
    private readonly outpatient: OutpatientRepository,
    @Inject(CLINICAL_REPOSITORY) private readonly repo: ClinicalRepository,
  ) {}

  @Post('vitals')
  @RequirePrivilege({ action: 'write', resourceType: 'observation' })
  @Audited({ action: 'observation.record', resourceType: 'observation' })
  async vitals(
    @Body() dto: RecordVitalsDto,
    @CurrentContext() ctx?: RequestContext,
    @Headers('authorization') authorization?: string,
  ) {
    if (authorization?.startsWith('Bearer staff_')) {
      const scope = await this.patients.scope(
        authorization,
        ctx?.facilityId,
        ctx?.tenantId,
      );
      if (!Array.isArray(dto.observations) || !dto.observations.length)
        throw new BadRequestException({
          message: 'Select observations to record',
        });
      for (const observation of dto.observations) {
        await this.patients.identity(scope, observation.patientId);
        if (observation.encounterId) {
          const encounter = await this.encounters.findById(
            observation.encounterId,
          );
          if (
            !encounter ||
            encounter.facilityId !== scope.facilityId ||
            encounter.patientId !== observation.patientId ||
            !['open', 'admitted'].includes(encounter.status)
          )
            throw new ForbiddenException({
              code: 'ENCOUNTER_ACCESS_DENIED',
              message:
                'Select an active encounter for this patient in this facility',
            });
        }
        const active = await this.outpatient.current(
          scope,
          observation.patientId,
        );
        if (active)
          throw new ConflictException({
            code: 'OUTPATIENT_VITALS_ROUTE_REQUIRED',
            message:
              'Record this outpatient visit through its assigned vitals worklist',
          });
      }
    }
    return this.clinical.recordVitals({
      observations: dto.observations.map((o) => ({
        patientId: o.patientId,
        ...(o.encounterId ? { encounterId: o.encounterId } : {}),
        code: o.code,
        ...(o.valueNum !== undefined ? { valueNum: o.valueNum } : {}),
        ...(o.valueText ? { valueText: o.valueText } : {}),
        ...(o.unit ? { unit: o.unit } : {}),
      })),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('notes')
  @RequirePrivilege({ action: 'write', resourceType: 'note' })
  @Audited({ action: 'note.draft', resourceType: 'note' })
  draft(
    @Body() dto: DraftNoteDto,
    @CurrentContext() ctx?: RequestContext,
    @Headers('authorization') authorization?: string,
  ) {
    this.staffNoteRoute(authorization);
    return this.clinical.draftNote({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      chiefComplaint: dto.chiefComplaint,
      history: dto.history ?? '',
      examination: dto.examination ?? '',
      assessment: dto.assessment ?? '',
      plan: dto.plan ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Post('notes/:id/sign')
  @RequirePrivilege({ action: 'sign', resourceType: 'note' })
  @Audited({ action: 'note.sign', resourceType: 'note' })
  sign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
    @Headers('authorization') authorization?: string,
  ) {
    this.staffNoteRoute(authorization);
    return this.clinical.signNote(id, { correlationId: ctx?.correlationId });
  }

  @Post('notes/:id/addenda')
  @RequirePrivilege({ action: 'amend', resourceType: 'note' })
  @Audited({ action: 'note.addendum', resourceType: 'note' })
  addendum(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddendumDto,
    @Headers('authorization') authorization?: string,
  ) {
    this.staffNoteRoute(authorization);
    return this.clinical.addAddendum(id, dto.text);
  }
  private staffNoteRoute(authorization?: string) {
    if (authorization?.startsWith('Bearer staff_'))
      throw new ConflictException({
        code: 'STAFF_NOTE_WORKFLOW_REQUIRED',
        message:
          'Use the patient chart note workflow to preserve author, encounter and revision checks',
      });
  }

  @Post('entries')
  @RequirePrivilege({ action: 'write', resourceType: 'entry' })
  @Audited({ action: 'entry.record', resourceType: 'entry' })
  entry(@Body() dto: RecordEntryDto, @CurrentContext() ctx?: RequestContext, @Headers('authorization') authorization?:string) {
    if(authorization?.startsWith('Bearer staff_'))throw new ConflictException({code:'STAFF_ENTRY_WORKFLOW_REQUIRED',message:'Use the patient chart problem-list workflow to preserve care scope and attribution.'});
    return this.clinical.recordEntry({
      patientId: dto.patientId,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      kind: dto.kind,
      ...(dto.code ? { code: dto.code } : {}),
      display: dto.display,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('patients/:id/timeline')
  @Header('Cache-Control', 'no-store')
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  async timeline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authorization?: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    const scope = await this.patients.scope(
      authorization,
      ctx?.facilityId,
      ctx?.tenantId,
    );
    await this.patients.identity(scope, id);
    if (!scope.privileges.includes('timeline:read'))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You cannot view the clinical timeline',
      });
    const n = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    return this.repo.timeline(id, n);
  }

  @Get('handovers')
  @RequirePrivilege({ action: 'read', resourceType: 'handover' })
  handover(@Query('facilityId') facilityId: string) {
    return this.clinical.handover(facilityId);
  }

  @Get('patients/:id/export')
  @RequirePrivilege({ action: 'export', resourceType: 'patient' })
  @Audited({ action: 'patient.export', resourceType: 'patient' })
  patientExport(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.clinical.exportBundle(id);
  }
}
