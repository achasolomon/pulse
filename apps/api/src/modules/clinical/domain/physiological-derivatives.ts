import type { PhysiologicalDerivative, StaffChartOverview, StaffPatientIdentity } from '@pulse/api-contracts';
type Observation = StaffChartOverview['observations']['items'][number];
const version = 'physiology-2026-10-15.v1';
const definitions = [
  ['bmi', 'Body mass index', 'kg/m²', 'weight (kg) / height (m)²', 'https://www.nice.org.uk/guidance/ng246/chapter/Identifying-and-assessing-overweight-obesity-and-central-adiposity'],
  ['bsa', 'Body surface area', 'm²', 'Mosteller: √(height (cm) × weight (kg) / 3600)', 'https://pubmed.ncbi.nlm.nih.gov/3657876/'],
  ['lean-mass', 'Estimated lean mass', 'kg', 'Janmahasatian: male 9270W/(6680+216BMI); female 9270W/(8780+244BMI)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3833312/'],
  ['pulse-pressure', 'Pulse pressure', 'mmHg', 'systolic − diastolic', 'https://pubmed.ncbi.nlm.nih.gov/32694334/'],
  ['map', 'Estimated MAP', 'mmHg', 'diastolic + (systolic − diastolic)/3', 'https://pubmed.ncbi.nlm.nih.gov/32694334/'],
];
const number = (item?: Observation) => item?.value && /^\d+(?:\.\d+)?$/.test(item.value.trim()) && Number.isFinite(Number(item.value)) && Number(item.value) > 0 ? Number(item.value) : null;
const matching = (a?: Observation, b?: Observation) => !!(a?.encounterId && a.encounterId === b?.encounterId && a.takenAt === b.takenAt && a.origin === b.origin);
export function physiologicalDerivatives(items: Observation[], patient: Pick<StaffPatientIdentity, 'dateOfBirth' | 'sex'>, now = new Date(), enabled = true): PhysiologicalDerivative[] {
  const find = (code: string) => items.find((item) => item.code === code);
  const weight = find('weight'), height = find('height'), systolic = find('bp-systolic'), diastolic = find('bp-diastolic');
  return definitions.map(([code, label, unit, formula, sourceUrl]) => {
    const result: PhysiologicalDerivative = {code, label, unit, formula, sourceUrl, value: null, category: 'Unavailable', status: 'not-assessed', reason: '', sourceIds: [], measuredAt: null, ruleVersion: version};
    const unavailable = (reason: string) => ({...result, reason});
    if (!enabled) return unavailable('Physiological calculations are disabled for this deployment.');
    const body = ['bmi', 'bsa', 'lean-mass'].includes(code);
    const a = body ? weight : systolic, b = body ? height : diastolic;
    if (!a || !b) return unavailable(body ? 'Record both height and weight to calculate.' : 'Record both blood-pressure components to calculate.');
    if (!matching(a, b)) return unavailable('Inputs must have the same encounter, recording time and source.');
    const taken = new Date(a.takenAt), birth = new Date(patient.dateOfBirth);
    if (!Number.isFinite(taken.getTime()) || !Number.isFinite(birth.getTime()) || taken > now || birth > taken) return unavailable('Valid measurement and birth dates are required.');
    let age = taken.getUTCFullYear() - birth.getUTCFullYear();
    if (taken.getUTCMonth() < birth.getUTCMonth() || (taken.getUTCMonth() === birth.getUTCMonth() && taken.getUTCDate() < birth.getUTCDate())) age--;
    if (age < 18) return unavailable('This calculation profile is for adults; paediatric interpretation is separate.');
    const x = number(a), y = number(b);
    if (x === null || y === null) return unavailable('Positive numeric inputs are required.');
    result.sourceIds = [a.id, b.id]; result.measuredAt = a.takenAt;
    if (body) {
      const kg = a.unit === 'kg' ? x : ['lb', 'lbs'].includes(a.unit ?? '') ? x * 0.45359237 : null;
      const cm = b.unit === 'cm' ? y : b.unit === 'm' ? y * 100 : ['in', '[in_i]'].includes(b.unit ?? '') ? y * 2.54 : null;
      if (kg === null || cm === null) return unavailable('Supported height and weight units are required.');
      const bmi = kg / ((cm / 100) ** 2);
      if (!Number.isFinite(bmi) || bmi <= 0) return unavailable('Inputs cannot produce a finite BMI.');
      if (code === 'bmi') {
        result.value = Math.round(bmi * 10) / 10;
        result.category = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy-weight band' : bmi < 30 ? 'Overweight' : bmi < 35 ? 'Obesity class 1' : bmi < 40 ? 'Obesity class 2' : 'Obesity class 3';
        result.status = bmi < 18.5 || bmi >= 25 ? 'attention' : 'not-flagged';
        result.reason = `General adult BMI bands use the unrounded BMI (${bmi.toPrecision(8)}), not a diagnosis. Ethnicity-specific lower thresholds, pregnancy, oedema and high muscle mass require clinical interpretation.`;
        return result;
      }
      if (code === 'lean-mass' && !['M', 'F'].includes(patient.sex)) return unavailable('This sex-specific formula requires a recorded male or female sex; no value is inferred.');
      const value = code === 'bsa' ? Math.sqrt(cm * kg / 3600) : 9270 * kg / (patient.sex === 'M' ? 6680 + 216 * bmi : 8780 + 244 * bmi);
      if (!Number.isFinite(value) || (code === 'lean-mass' && value > kg)) return unavailable('Inputs are outside the supported estimate; review measurements.');
      result.value = Math.round(value * (code === 'bsa' ? 100 : 10)) / (code === 'bsa' ? 100 : 10);
      result.category = 'Estimate'; result.status = 'not-flagged';
      result.reason = 'Formula estimate; no universal normal band is assigned. Not a measured body-composition result or an automatic medication dose.';
    } else {
      if (a.unit !== 'mmHg' || b.unit !== 'mmHg' || x <= y) return unavailable('BP must be in mmHg with systolic greater than diastolic.');
      result.value = Math.round((code === 'map' ? y + (x - y) / 3 : x - y) * 10) / 10;
      result.category = code === 'map' ? 'Estimate' : 'Calculated'; result.status = 'not-flagged';
      result.reason = code === 'map' ? 'Approximate MAP from cuff BP; not a directly measured arterial MAP. No patient-specific target is assumed.' : 'Calculated from paired BP; no patient-specific normal band is assumed.';
    }
    return result;
  });
}
