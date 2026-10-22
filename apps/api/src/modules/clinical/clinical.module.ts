import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DocumentModule } from '../documents/documents.module.js';
import { ClinicalService } from './application/clinical.service.js';
import { CLINICAL_REPOSITORY } from './domain/clinical.repository.js';
import { KyselyClinicalRepository } from './infrastructure/kysely-clinical.repository.js';
import { ClinicalController } from './interface/clinical.controller.js';
import { StaffChartController } from './interface/staff-chart.controller.js';
import { STAFF_CHART_REPOSITORY } from './domain/staff-chart.repository.js';
import { KyselyStaffChartRepository } from './infrastructure/kysely-staff-chart.repository.js';
import { OutpatientVitalsController } from './interface/outpatient-vitals.controller.js';
import { OUTPATIENT_VITALS_REPOSITORY } from './domain/outpatient-vitals.repository.js';
import { KyselyOutpatientVitalsRepository } from './infrastructure/kysely-outpatient-vitals.repository.js';
import { STAFF_CHART_HISTORY_REPOSITORY } from './domain/staff-chart-history.repository.js';
import { KyselyStaffChartHistoryRepository } from './infrastructure/kysely-staff-chart-history.repository.js';
import {StaffNoteController} from './interface/staff-note.controller.js';
import {STAFF_NOTE_REPOSITORY} from './domain/staff-note.repository.js';
import {KyselyStaffNoteRepository} from './infrastructure/kysely-staff-note.repository.js';
import {StaffEntryController} from './interface/staff-entry.controller.js';
import {STAFF_ENTRY_REPOSITORY} from './domain/staff-entry.repository.js';
import {KyselyStaffEntryRepository} from './infrastructure/kysely-staff-entry.repository.js';
import {StaffAllergyController} from './interface/staff-allergy.controller.js';
import {STAFF_ALLERGY_REPOSITORY} from './domain/staff-allergy.repository.js';
import {KyselyStaffAllergyRepository} from './infrastructure/kysely-staff-allergy.repository.js';

@Module({
  imports: [OutboxModule, IamModule, EncounterModule, PatientModule, WorkflowModule, DocumentModule],
  controllers: [ClinicalController, StaffChartController,OutpatientVitalsController,StaffNoteController,StaffEntryController,StaffAllergyController],
  providers: [
    {provide:STAFF_ALLERGY_REPOSITORY,useClass:KyselyStaffAllergyRepository},
    {provide:STAFF_ENTRY_REPOSITORY,useClass:KyselyStaffEntryRepository},
    {provide:STAFF_NOTE_REPOSITORY,useClass:KyselyStaffNoteRepository},
    {provide:STAFF_CHART_HISTORY_REPOSITORY,useClass:KyselyStaffChartHistoryRepository},
    ClinicalService,
    {provide:OUTPATIENT_VITALS_REPOSITORY,useClass:KyselyOutpatientVitalsRepository},
    { provide: STAFF_CHART_REPOSITORY, useClass: KyselyStaffChartRepository },
    { provide: CLINICAL_REPOSITORY, useClass: KyselyClinicalRepository },
  ],
  exports: [ClinicalService, CLINICAL_REPOSITORY],
})
export class ClinicalModule {}
