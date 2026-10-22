import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import type { StaffChartOverview } from '@pulse/api-contracts';
import { assessVital } from '../domain/vital-assessment.js';
import { physiologicalDerivatives } from '../domain/physiological-derivatives.js';
import type { StaffChartSection } from '@pulse/api-contracts';
import {
  STAFF_CHART_HISTORY_REPOSITORY,
  type StaffChartHistoryRepository,
} from '../domain/staff-chart-history.repository.js';
import { StaffPatientReadService } from '../../patient/application/staff-patient-read.service.js';
import {
  StaffPatientReadGuard,
  type PatientReadRequest,
} from '../../patient/interface/staff-patient-read.controller.js';
import {
  STAFF_CHART_REPOSITORY,
  type StaffChartRepository,
} from '../domain/staff-chart.repository.js';
@Controller('staff/charts')
@UseGuards(StaffPatientReadGuard)
export class StaffChartController {
  constructor(
    private readonly patients: StaffPatientReadService,
    @Inject(STAFF_CHART_REPOSITORY)
    private readonly charts: StaffChartRepository,
    @Inject(STAFF_CHART_HISTORY_REPOSITORY)
    private readonly history: StaffChartHistoryRepository,
  ) {}
  @Get(':id/history/:section')
  @Header('Cache-Control', 'no-store')
  async historyPage(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('section') section: string,
    @Query('cursor') cursor?: string,
    @Query('encounterId') encounterId?: string,
  ) {
    const permissions: Record<StaffChartSection, string[]> = {
      visits: ['encounter:read'],
      vitals: ['observation:read'],
      entries: ['entry:read'],
      notes: ['note:read'],
      medications: ['medication:read'],
      investigations: ['lab:read', 'imaging:view'],
      documents: ['document:read'],
      profile: ['patient:read'],
    };
    if (!Object.hasOwn(permissions, section) || (cursor && cursor.length > 400))
      throw new BadRequestException({
        message: 'Select a valid chart section',
      });
    if (
      encounterId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        encounterId,
      )
    )
      throw new BadRequestException({ message: 'Select a valid encounter' });
    const scope = req.patientReadScope;
    if (
      !permissions[section as StaffChartSection].some((p) =>
        scope.privileges.includes(p),
      )
    )
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You do not have access to this chart section',
      });
    await this.patients.identity(scope, id);
    return this.history.read(
      scope,
      id,
      section as StaffChartSection,
      cursor,
      encounterId,
    );
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async overview(
    @Req() req: PatientReadRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StaffChartOverview> {
    const scope = req.patientReadScope;
    const patient = await this.patients.identity(scope, id);
    const sections = await this.charts.sections({
      ...scope,
      patientId: id,
      observations: scope.privileges.includes('observation:read'),
      entries: scope.privileges.includes('entry:read'),
    });
    const evaluatedAt = new Date();
    const screeningEnabled = process.env.PULSE_VITAL_SCREENING_ENABLED === 'true' ||
      (process.env.NODE_ENV !== 'production' && process.env.PULSE_VITAL_SCREENING_ENABLED !== 'false');
    return { patient, fetchedAt: evaluatedAt.toISOString(), ...sections,
      observations: { ...sections.observations, ...(sections.observations.access === 'available' ? { derived: physiologicalDerivatives(sections.observations.items, patient, evaluatedAt, screeningEnabled) } : {}), items: sections.observations.items.map((observation) => ({ ...observation, assessment: assessVital(observation, patient.dateOfBirth, evaluatedAt, screeningEnabled) })) },
    };
  }
}
