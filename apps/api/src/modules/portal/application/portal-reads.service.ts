import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PATIENT_REPOSITORY, type PatientRepository } from '../../patient/domain/patient.repository.js';
import { APPOINTMENT_REPOSITORY, type AppointmentRepository } from '../../scheduling/domain/appointment.repository.js';
import { CLINICAL_REPOSITORY, type ClinicalRepository } from '../../clinical/domain/clinical.repository.js';
import { MEDICATION_REPOSITORY, type MedicationRepository } from '../../medication/domain/medication.repository.js';
import { REVENUE_REPOSITORY, type RevenueRepository } from '../../revenue/domain/revenue.repository.js';
import { REFERRAL_REPOSITORY, type ReferralRepository } from '../../referral/domain/referral.repository.js';
import { LAB_REPOSITORY, type LabRepository } from '../../laboratory/domain/lab.repository.js';
import { invoiceBalance } from '../../revenue/domain/revenue.repository.js';

/**
 * Portal reads (EPIC-19). Every read is scoped to the acting patient from the
 * session — never a query parameter — so cross-patient access is impossible
 * by construction. Proxy reads resolve through the same path; the session
 * carries both identities for audit.
 */
@Injectable()
export class PortalReadsService {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(APPOINTMENT_REPOSITORY) private readonly apptRepo: AppointmentRepository,
    @Inject(CLINICAL_REPOSITORY) private readonly clinical: ClinicalRepository,
    @Inject(MEDICATION_REPOSITORY) private readonly medications: MedicationRepository,
    @Inject(REVENUE_REPOSITORY) private readonly revenue: RevenueRepository,
    @Inject(REFERRAL_REPOSITORY) private readonly referralRepo: ReferralRepository,
    @Inject(LAB_REPOSITORY) private readonly lab: LabRepository,
  ) {}

  me(patientId: string) {
    return this.patients.findById(patientId);
  }

  appointments(patientId: string) {
    return this.apptRepo.appointmentsFor(patientId, 25);
  }

  timeline(patientId: string) {
    return this.clinical.timeline(patientId, 50);
  }

  prescriptions(patientId: string) {
    return this.medications.prescriptionsFor(patientId, 25);
  }

  invoices(patientId: string) {
    return this.revenue.invoicesFor(patientId, 25);
  }

  async invoiceBalance(patientId: string, invoiceId: string) {
    // Ownership check first: invoice must belong to the acting patient.
    const owned = await this.revenue.invoicesFor(patientId, 100);
    if (!owned.some((i) => i.id === invoiceId)) {
      throw new ForbiddenException({ code: 'PORTAL_SCOPE', message: 'Not your invoice' });
    }
    const { lines } = await this.revenue.invoiceTotals(invoiceId);
    const payments = await this.revenue.paymentsFor(invoiceId);
    const adjustments = await this.revenue.adjustmentsFor(invoiceId);
    return invoiceBalance({ lines, payments, adjustments });
  }

  referrals(patientId: string) {
    return this.referralRepo.casesFor(patientId, 25);
  }

  labOrders(patientId: string) {
    return this.lab.ordersFor(patientId, 25);
  }
}
