import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import configuration from './platform/config/configuration.js';
import { CorrelationMiddleware } from './platform/common/middleware/correlation.middleware.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthModule } from './platform/health/health.module.js';
import { AuditModule } from './platform/audit/audit.module.js';
import { OutboxModule } from './platform/outbox/outbox.module.js';
import { MetricsModule } from './platform/observability/metrics.module.js';
import { PlatformSecurityModule } from './platform/security/security.module.js';
import { SecurityModule } from './modules/security/security.module.js';
import { SreModule } from './modules/sre/sre.module.js';
import { DialysisModule } from './modules/dialysis/dialysis.module.js';
import { EquipmentModule } from './modules/equipment/equipment.module.js';
import { RosterModule } from './modules/roster/roster.module.js';
import { BedflowModule } from './modules/bedflow/bedflow.module.js';
import { ResearchModule } from './modules/research/research.module.js';
import { IamModule } from './modules/iam/iam.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { PatientModule } from './modules/patient/patient.module.js';
import { EncounterModule } from './modules/encounter/encounter.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { ClinicalModule } from './modules/clinical/clinical.module.js';
import { LaboratoryModule } from './modules/laboratory/laboratory.module.js';
import { ImagingModule } from './modules/imaging/imaging.module.js';
import { MedicationModule } from './modules/medication/medication.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { DocumentModule } from './modules/documents/documents.module.js';
import { RevenueModule } from './modules/revenue/revenue.module.js';
import { ConsentModule } from './modules/consent/consent.module.js';
import { ReferralModule } from './modules/referral/referral.module.js';
import { FhirModule } from './modules/fhir/fhir.module.js';
import { InsuranceModule } from './modules/insurance/insurance.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { EmergencyModule } from './modules/emergency/emergency.module.js';
import { TheatreModule } from './modules/theatre/theatre.module.js';
import { BloodbankModule } from './modules/bloodbank/bloodbank.module.js';
import { AnatomyModule } from './modules/anatomy/anatomy.module.js';
import { SecureExampleController } from './modules/iam/interface/secure-example.controller.js';

// export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Abuse protection (SEC-001): generous default; strict overrides on
    // credential/partner surfaces. In-memory store: single instance only —
    // Redis storage lands with multi-instance deployment.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    HealthModule,
    DatabaseModule,
    AuditModule,
    OutboxModule,
    MetricsModule,
    PlatformSecurityModule,
    SecurityModule,
    SreModule,
    DialysisModule,
    EquipmentModule,
    RosterModule,
    BedflowModule,
  ResearchModule,
    IamModule,
    OrganizationModule,
    PatientModule,
    EncounterModule,
    SchedulingModule,
    ClinicalModule,
    LaboratoryModule,
    ImagingModule,
    MedicationModule,
    InventoryModule,
    WorkflowModule,
    DocumentModule,
    RevenueModule,
    ConsentModule,
    ReferralModule,
    FhirModule,
    InsuranceModule,
    ReportsModule,
    PortalModule,
    SyncModule,
    EmergencyModule,
    TheatreModule,
    BloodbankModule,
    AnatomyModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
  ],
  controllers: [AppController, SecureExampleController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
