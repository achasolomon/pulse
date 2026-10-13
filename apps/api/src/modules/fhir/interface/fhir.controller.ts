import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ExternalImportService } from '../application/external-import.service.js';
import { FhirService } from '../application/fhir.service.js';
import {
  PARTNER_REPOSITORY,
  hashApiKey,
  type PartnerRepository,
} from '../infrastructure/partner.repository.js';
import { PartnerApiKeyGuard } from './partner-key.guard.js';
import { PartnerWriteScopeGuard } from './partner-write-scope.guard.js';
import { IsOptional, IsString } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[];
}

export class Hl7v2OruDto {
  @IsString()
  message!: string;
}

type PartnerRequest = Request & { partnerId?: string };

/**
 * FHIR surface (EPIC-18, ADR-005 boundary).
 * - /fhir/v1/metadata + reads: partner key surface (no tenant context needed).
 * - /fhir/v1/{Condition,AllergyIntolerance,Observation} + hl7v2/oru: partner
 *   key + write scope (FHIR-001 sections 47, 62-65).
 * - /fhir/v1/partners: staff-administered partner registry.
 */
@Controller('fhir/v1')
export class FhirController {
  constructor(
    private readonly fhir: FhirService,
    private readonly imports: ExternalImportService,
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
  ) {}

  @Post('partners')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'integration' })
  @Audited({ action: 'partner.create', resourceType: 'integration_partner' })
  async createPartner(@Body() dto: CreatePartnerDto) {
    const raw = `pulse_${randomBytes(24).toString('hex')}`;
    const created = await this.partners.create({
      name: dto.name,
      apiKeyHash: hashApiKey(raw),
      scopes: dto.scopes ?? ['read'],
    });
    // Plaintext shown once, never stored.
    return { id: created.id, apiKey: raw };
  }

  @Get('metadata')
  metadata() {
    return this.fhir.metadata();
  }

  @Get('Patient/:id')
  @UseGuards(PartnerApiKeyGuard)
  readPatient(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: PartnerRequest) {
    return this.fhir.readPatient(id, req.partnerId);
  }

  @Get('Patient')
  @UseGuards(PartnerApiKeyGuard)
  searchPatient(@Query('identifier') identifier: string, @Req() req: PartnerRequest) {
    return this.fhir.searchPatient(identifier ?? '', req.partnerId);
  }

  @Get('Observation')
  @UseGuards(PartnerApiKeyGuard)
  searchObservations(@Query('patient') patient: string, @Req() req: PartnerRequest) {
    return this.fhir.searchObservations(patient, req.partnerId);
  }

  @Get('Encounter/:id')
  @UseGuards(PartnerApiKeyGuard)
  readEncounter(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: PartnerRequest) {
    return this.fhir.readEncounter(id, req.partnerId);
  }

  @Post('Condition')
  @UseGuards(PartnerApiKeyGuard, PartnerWriteScopeGuard)
  async createCondition(
    @Body() resource: unknown,
    @Req() req: PartnerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const out = await this.imports.importCondition({
      partnerId: req.partnerId,
      idempotencyKey,
      resource,
    });
    return this.sendWrite(res, out);
  }

  @Post('AllergyIntolerance')
  @UseGuards(PartnerApiKeyGuard, PartnerWriteScopeGuard)
  async createAllergyIntolerance(
    @Body() resource: unknown,
    @Req() req: PartnerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const out = await this.imports.importAllergyIntolerance({
      partnerId: req.partnerId,
      idempotencyKey,
      resource,
    });
    return this.sendWrite(res, out);
  }

  @Post('Observation')
  @UseGuards(PartnerApiKeyGuard, PartnerWriteScopeGuard)
  async createObservation(
    @Body() resource: unknown,
    @Req() req: PartnerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const out = await this.imports.importObservation({
      partnerId: req.partnerId,
      idempotencyKey,
      resource,
    });
    return this.sendWrite(res, out);
  }

  @Post('hl7v2/oru')
  @UseGuards(PartnerApiKeyGuard, PartnerWriteScopeGuard)
  async createHl7v2Oru(
    @Body() dto: Hl7v2OruDto,
    @Req() req: PartnerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.imports.importHl7v2Oru({
      partnerId: req.partnerId,
      message: dto.message,
    });
    return this.sendWrite(res, out);
  }

  /** 201 created / 200 idempotent replay with explicit replay indicator (API-001 §26). */
  private sendWrite(res: Response, out: { created: boolean; resource: Record<string, unknown> }) {
    res.status(out.created ? 201 : 200);
    if (!out.created) res.header('x-idempotent-replay', 'true');
    return out.resource;
  }
}
