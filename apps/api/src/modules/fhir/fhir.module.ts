import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { ExternalImportService } from './application/external-import.service.js';
import { FhirService } from './application/fhir.service.js';
import {
  PARTNER_REPOSITORY,
  KyselyPartnerRepository,
} from './infrastructure/partner.repository.js';
import {
  EXTERNAL_RESOURCE_REPOSITORY,
  KyselyExternalResourceRepository,
} from './infrastructure/external-resource.repository.js';
import { PartnerApiKeyGuard } from './interface/partner-key.guard.js';
import { PartnerWriteScopeGuard } from './interface/partner-write-scope.guard.js';
import { FhirController } from './interface/fhir.controller.js';

@Module({
  imports: [OutboxModule, IamModule, PatientModule, EncounterModule, ClinicalModule],
  controllers: [FhirController],
  providers: [
    FhirService,
    ExternalImportService,
    PartnerApiKeyGuard,
    PartnerWriteScopeGuard,
    { provide: PARTNER_REPOSITORY, useClass: KyselyPartnerRepository },
    { provide: EXTERNAL_RESOURCE_REPOSITORY, useClass: KyselyExternalResourceRepository },
  ],
  exports: [FhirService, ExternalImportService, PARTNER_REPOSITORY],
})
export class FhirModule {}
