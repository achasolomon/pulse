import type { VitalAssessment } from '@pulse/api-client';
type Observation = {
  id: string;
  code: string;
  value: string | null;
  unit: string | null;
  takenAt: string;
  origin: string;
  encounterId?: string | null;
  assessment?: VitalAssessment;
};

/** Only combine measurements with matching recorded clinical context. */
export function overviewObservations(items: Observation[]) {
  const systolic = items.find((item) => item.code === "bp-systolic");
  const diastolic = systolic?.encounterId
    ? items.find((item) => item.code === "bp-diastolic" &&
        item.encounterId === systolic.encounterId &&
        item.takenAt === systolic.takenAt && item.origin === systolic.origin &&
        item.unit === systolic.unit && item.value !== null && systolic.value !== null)
    : undefined;
  return items.filter((item) => item !== diastolic).map((item) => ({
    ...item,
    code: item === systolic && diastolic ? "blood-pressure" : item.code,
    value: item === systolic && diastolic ? `${item.value}/${diastolic.value}` : item.value,
    assessment: item === systolic && diastolic ? pairedAssessment(item.assessment, diastolic.assessment) : item.assessment,
  }));
}

function pairedAssessment(systolic?: VitalAssessment, diastolic?: VitalAssessment) {
  const rank = { urgent: 3, attention: 2, 'not-assessed': 1, 'not-flagged': 0 };
  if (!systolic || !diastolic) {
    const available = systolic ?? diastolic;
    return available && ['urgent', 'attention'].includes(available.status) ? available : undefined;
  }
  return rank[diastolic.status] > rank[systolic.status] ? diastolic : systolic;
}
