import {
  Body,
  Controller,
  Get,
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
import { InventoryService } from '../application/inventory.service.js';
import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
} from '../domain/inventory.repository.js';
import { CreateLocationDto, DefineItemDto, IssueDto, ProcureDto, ReceiveDto, ReconcileDto } from './dto.js';

/** Inventory endpoints (EPIC-13). All tenant-scoped + audited. */
@Controller('inventory')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    @Inject(INVENTORY_REPOSITORY) private readonly repo: InventoryRepository,
  ) {}

  @Post('items')
  @RequirePrivilege({ action: 'manage', resourceType: 'inventory' })
  @Audited({ action: 'inventory.item_define', resourceType: 'inventory_item' })
  defineItem(@Body() dto: DefineItemDto) {
    return this.inventory.defineItem({
      code: dto.code,
      name: dto.name,
      baseUnit: dto.baseUnit,
    });
  }

  @Post('locations')
  @RequirePrivilege({ action: 'manage', resourceType: 'inventory' })
  @Audited({ action: 'inventory.location_create', resourceType: 'inventory_location' })
  createLocation(@Body() dto: CreateLocationDto) {
    return this.inventory.createLocation({
      facilityId: dto.facilityId,
      name: dto.name,
      code: dto.code,
    });
  }

  @Post('receive')
  @RequirePrivilege({ action: 'receive', resourceType: 'inventory' })
  @Audited({ action: 'inventory.receive', resourceType: 'stock' })
  receive(@Body() dto: ReceiveDto, @CurrentContext() ctx?: RequestContext) {
    return this.inventory.receive({
      itemId: dto.itemId,
      locationId: dto.locationId,
      quantityBase: dto.quantityBase,
      ...(dto.lotNumber ? { lotNumber: dto.lotNumber } : {}),
      ...(dto.expiresOn ? { expiresOn: dto.expiresOn } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('issue')
  @RequirePrivilege({ action: 'issue', resourceType: 'inventory' })
  @Audited({ action: 'inventory.issue', resourceType: 'stock' })
  issue(@Body() dto: IssueDto, @CurrentContext() ctx?: RequestContext) {
    return this.inventory.issue({
      itemId: dto.itemId,
      locationId: dto.locationId,
      quantityBase: dto.quantityBase,
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('reconcile')
  @RequirePrivilege({ action: 'reconcile', resourceType: 'inventory' })
  @Audited({ action: 'inventory.reconcile', resourceType: 'stock' })
  reconcile(@Body() dto: ReconcileDto, @CurrentContext() ctx?: RequestContext) {
    return this.inventory.reconcile({
      itemId: dto.itemId,
      locationId: dto.locationId,
      counted: dto.counted,
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('procure')
  @RequirePrivilege({ action: 'procure', resourceType: 'inventory' })
  @Audited({ action: 'inventory.procure', resourceType: 'procurement' })
  procure(@Body() dto: ProcureDto, @CurrentContext() ctx?: RequestContext) {
    return this.inventory.procure({
      facilityId: dto.facilityId,
      itemId: dto.itemId,
      quantityBase: dto.quantityBase,
      locationId: dto.locationId,
      supplier: dto.supplier,
      ...(dto.lotNumber ? { lotNumber: dto.lotNumber } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('balance')
  @RequirePrivilege({ action: 'read', resourceType: 'inventory' })
  balance(@Query('itemId') itemId: string, @Query('locationId') locationId: string) {
    return this.repo.balance(itemId, locationId).then((total) => ({ total }));
  }

  @Get('lots/:itemId/fefo')
  @RequirePrivilege({ action: 'read', resourceType: 'inventory' })
  fefo(@Param('itemId', new ParseUUIDPipe()) itemId: string) {
    return this.inventory.suggestLot(itemId);
  }
}
