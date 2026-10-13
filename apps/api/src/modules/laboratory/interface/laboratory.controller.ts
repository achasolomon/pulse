import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { LaboratoryService } from '../application/laboratory.service.js';
import {
  LAB_REPOSITORY,
  type LabRepository,
} from '../domain/lab.repository.js';
import { AckDto, CancelOrderDto, CollectDto, DefineTestDto, PlaceOrderDto, ResultDto, VerifyDto } from './dto.js';

/** Laboratory endpoints (EPIC-10). All tenant-scoped + audited. */
@Controller('lab')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class LaboratoryController {
  constructor(
    private readonly lab: LaboratoryService,
    @Inject(LAB_REPOSITORY) private readonly repo: LabRepository,
  ) {}

  @Post('tests')
  @RequirePrivilege({ action: 'manage', resourceType: 'lab_catalog' })
  @Audited({ action: 'lab.test_define', resourceType: 'lab_catalog' })
  defineTest(@Body() dto: DefineTestDto) {
    return this.lab.defineTest({
      code: dto.code,
      name: dto.name,
      specimenRequirement: dto.specimenRequirement ?? '',
    });
  }

  @Post('orders')
  @RequirePrivilege({ action: 'order', resourceType: 'lab' })
  @Audited({ action: 'lab.order', resourceType: 'lab_order' })
  order(@Body() dto: PlaceOrderDto, @CurrentContext() ctx?: RequestContext) {
    return this.lab.placeOrder({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      testCode: dto.testCode,
      urgency: dto.urgency ?? 'routine',
      indication: dto.indication ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Get('orders/worklist')
  @RequirePrivilege({ action: 'read', resourceType: 'lab' })
  worklist(@Query('status') status?: string) {
    const statuses = (status ? status.split(',') : ['ordered', 'collected', 'accessioned', 'resulted']) as never;
    return this.repo.worklist(statuses, 50);
  }

  @Post('orders/:id/collect')
  @RequirePrivilege({ action: 'collect', resourceType: 'lab' })
  @Audited({ action: 'lab.collect', resourceType: 'lab_order' })
  collect(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CollectDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.lab.collect(id, {
      container: dto.container,
      label: dto.label,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/accession')
  @RequirePrivilege({ action: 'accession', resourceType: 'lab' })
  @Audited({ action: 'lab.accession', resourceType: 'lab_order' })
  accession(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.lab.accession(id, { correlationId: ctx?.correlationId });
  }

  @Post('orders/:id/results')
  @RequirePrivilege({ action: 'result', resourceType: 'lab' })
  @Audited({ action: 'lab.result', resourceType: 'lab_order' })
  result(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResultDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.lab.result(id, {
      component: dto.component,
      valueText: dto.valueText,
      ...(dto.unit ? { unit: dto.unit } : {}),
      ...(dto.flag ? { flag: dto.flag } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/verify')
  @RequirePrivilege({ action: 'verify', resourceType: 'lab' })
  @Audited({ action: 'lab.verify', resourceType: 'lab_order' })
  verify(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.lab.verify(id, {
      verifiedBy: dto.verifiedBy,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/acknowledge-critical')
  @RequirePrivilege({ action: 'acknowledge', resourceType: 'lab' })
  @Audited({ action: 'lab.critical_ack', resourceType: 'lab_order' })
  ack(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AckDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.lab.acknowledgeCritical(id, {
      ackBy: dto.ackBy,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('orders/:id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'lab' })
  @Audited({ action: 'lab.cancel', resourceType: 'lab_order' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelOrderDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.lab.cancel(id, {
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }
}
