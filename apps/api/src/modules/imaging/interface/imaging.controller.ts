import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  Injectable,
  ConflictException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ImagingService } from '../application/imaging.service.js';
import { AcquireDto, CancelImagingDto, ImagingReportDto, PlaceImagingOrderDto } from './dto.js';

@Injectable()
class LegacyImagingStaffGuard implements CanActivate {
  canActivate(c:ExecutionContext){if(c.switchToHttp().getRequest<{headers:{authorization?:string}}>().headers.authorization?.startsWith('Bearer staff_'))throw new ConflictException({code:'STAFF_IMAGING_WORKFLOW_REQUIRED',message:'Use the scoped staff imaging workflow.'});return true;}
}
/** Imaging endpoints (EPIC-11). All tenant-scoped + audited. */
@Controller('imaging')
@UseGuards(TenantContextGuard, AuthorizationGuard,LegacyImagingStaffGuard)
export class ImagingController {
  constructor(private readonly imaging: ImagingService) {}

  @Post('orders')
  @RequirePrivilege({ action: 'order', resourceType: 'imaging' })
  @Audited({ action: 'imaging.order', resourceType: 'imaging_order' })
  order(@Body() dto: PlaceImagingOrderDto, @CurrentContext() ctx?: RequestContext) {
    return this.imaging.placeOrder({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      procedureCode: dto.procedureCode,
      bodyRegion: dto.bodyRegion,
      ...(dto.laterality ? { laterality: dto.laterality } : {}),
      indication: dto.indication ?? '',
      urgency: dto.urgency ?? 'routine',
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/schedule')
  @RequirePrivilege({ action: 'schedule', resourceType: 'imaging' })
  @Audited({ action: 'imaging.schedule', resourceType: 'imaging_order' })
  schedule(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.imaging.schedule(id, { correlationId: ctx?.correlationId });
  }

  @Post('orders/:id/protocol')
  @RequirePrivilege({ action: 'protocol', resourceType: 'imaging' })
  @Audited({ action: 'imaging.protocol', resourceType: 'imaging_order' })
  protocol(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.imaging.protocol(id, { correlationId: ctx?.correlationId });
  }

  @Post('orders/:id/acquire')
  @RequirePrivilege({ action: 'acquire', resourceType: 'imaging' })
  @Audited({ action: 'imaging.acquire', resourceType: 'imaging_order' })
  acquire(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AcquireDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.imaging.acquire(
      id,
      {
        studyUid: dto.studyUid,
        accession: dto.accession ?? '',
        modality: dto.modality ?? '',
        pacsRef: dto.pacsRef ?? `pacs://studies/${dto.studyUid}`,
      },
      { correlationId: ctx?.correlationId },
    );
  }

  @Post('orders/:id/report')
  @RequirePrivilege({ action: 'report', resourceType: 'imaging' })
  @Audited({ action: 'imaging.report', resourceType: 'imaging_order' })
  report(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ImagingReportDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.imaging.report(id, {
      text: dto.text,
      ...(dto.authorId ? { authorId: dto.authorId } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/finalize')
  @RequirePrivilege({ action: 'finalize', resourceType: 'imaging' })
  @Audited({ action: 'imaging.finalize', resourceType: 'imaging_order' })
  finalize(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.imaging.finalize(id, { correlationId: ctx?.correlationId });
  }

  @Post('orders/:id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'imaging' })
  @Audited({ action: 'imaging.cancel', resourceType: 'imaging_order' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelImagingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.imaging.cancel(id, {
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('orders/:id/viewer')
  @RequirePrivilege({ action: 'view', resourceType: 'imaging' })
  viewer(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.imaging.viewerRef(id);
  }
}
