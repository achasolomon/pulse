import type { StaffChartOverview, VitalAssessment } from '@pulse/api-contracts';
type Observation = StaffChartOverview['observations']['items'][number];
const version = 'adult-screening-2026-10-15.v2';
const bpSource = 'https://www.nice.org.uk/guidance/ng136/chapter/recommendations';
const temperatureSource = 'https://www.nhs.uk/symptoms/fever-in-adults/';

/** Positive screening signals only. Never diagnoses, treatment advice or a normal-range certification. */
export function assessVital(observation: Observation, dateOfBirth: string, evaluatedAt = new Date(), enabled = true): VitalAssessment {
  const result = (status: VitalAssessment['status'], label: string, reason: string, ruleId: string | null = null, sourceUrl: string | null = null): VitalAssessment => ({ status, label, reason, ruleId, ruleVersion: version, sourceUrl });
  const unassessed = (reason: string) => result('not-assessed', 'Not assessed', reason);
  if (!enabled) return unassessed('Adult screening is not enabled for this deployment.');
  const taken = new Date(observation.takenAt);
  const birth = new Date(dateOfBirth);
  if (!Number.isFinite(taken.getTime()) || !Number.isFinite(birth.getTime()) || birth > taken || taken > evaluatedAt)
    return unassessed('Valid date of birth and measurement time are required.');
  let age = taken.getUTCFullYear() - birth.getUTCFullYear();
  if (taken.getUTCMonth() < birth.getUTCMonth() || (taken.getUTCMonth() === birth.getUTCMonth() && taken.getUTCDate() < birth.getUTCDate())) age--;
  if (age < 18) return unassessed('Adult screening rules do not apply to measurements taken before age 18.');
  if (!['bp-systolic', 'bp-diastolic', 'temperature', 'respiratory-rate', 'heart-rate', 'spo2'].includes(observation.code))
    return unassessed('No screening rule is configured for this measurement.');
  const raw = observation.value?.trim();
  if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return unassessed('A numeric measurement is required.');
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (value === 0 && !['respiratory-rate', 'heart-rate', 'spo2'].includes(observation.code))) return unassessed('A valid non-negative rate/percentage or positive measurement is required.');
  if (['respiratory-rate', 'heart-rate', 'spo2'].includes(observation.code)) {
    const source = 'https://www.rcp.ac.uk/media/ctulqqbn/news2-executive-summary_0.pdf';
    const respiratory = observation.code === 'respiratory-rate';
    const saturation = observation.code === 'spo2';
    const units = saturation ? ['%'] : respiratory ? ['breaths/min', '/min', '1/min'] : ['bpm', '/min', '1/min'];
    if (!units.includes(observation.unit ?? '')) return unassessed('A supported recorded rate or percentage unit is required.');
    if (saturation && value > 100) return unassessed('Oxygen saturation must not exceed 100%.');
    const low = saturation ? 96 : respiratory ? 12 : 51;
    const high = saturation ? 100 : respiratory ? 20 : 90;
    const urgent = saturation ? value <= 91 : respiratory ? value <= 8 || value >= 25 : value <= 40 || value >= 131;
    const outside = value < low || value > high;
    const context = saturation ? 'Default adult SpO2 Scale 1 reference; prescribed oxygen targets, supplemental oxygen and hypercapnic respiratory failure must be reviewed separately.' : 'Adult NEWS2 component reference only; this is not a total NEWS2 score. Pregnancy and patient-specific baselines require separate assessment.';
    return { ...result(urgent ? 'urgent' : outside ? 'attention' : 'not-flagged', urgent ? 'Review promptly' : outside ? value < low ? 'Below reference' : 'Above reference' : 'Within reference', `Reference ${low}–${high} ${observation.unit}. ${context}`, `adult-${observation.code}-reference`, source), referenceRange: `${low}–${high} ${observation.unit}`, referenceLabel: saturation ? 'Default adult reference' : 'Adult reference' };
  }
  if (observation.code === 'temperature') {
    if (!['°C', 'C', 'Cel', '°F', 'F', '[degF]'].includes(observation.unit ?? '')) return unassessed('A supported Celsius or Fahrenheit unit is required.');
    const celsius = ['°F', 'F', '[degF]'].includes(observation.unit!) ? (value - 32) * 5 / 9 : value;
    return celsius >= 38
      ? result('attention', 'High temperature', 'Adult temperature is at or above 38°C. Review the patient and measurement context.', 'adult-temperature-high', temperatureSource)
      : result('not-flagged', 'No high flag', 'The adult high-temperature rule did not trigger. Low temperature and other patient-specific risks are not assessed.', 'adult-temperature-high', temperatureSource);
  }
  if (observation.unit !== 'mmHg') return unassessed('Blood-pressure screening requires a recorded unit of mmHg.');
  const systolic = observation.code === 'bp-systolic';
  const severe = systolic ? 180 : 120;
  const high = systolic ? 140 : 90;
  const component = systolic ? 'Systolic' : 'Diastolic';
  const context = 'This is a screening signal, not a diagnosis. Symptoms, pregnancy and patient-specific targets require separate clinical review.';
  if (value >= severe) return result('urgent', 'Severely high', `${component} BP is at or above ${severe} mmHg. Prompt clinical review is needed; emergency classification requires clinical assessment. ${context}`, 'adult-bp-high', bpSource);
  if (value >= high) return result('attention', 'High BP', `${component} BP is at or above ${high} mmHg. ${context}`, 'adult-bp-high', bpSource);
  return result('not-flagged', 'No high flag', `The adult high-BP rule did not trigger. Low BP, lower individual targets and other risks are not assessed. ${context}`, 'adult-bp-high', bpSource);
}
