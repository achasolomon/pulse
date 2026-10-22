"use client";
import type { StaffChartOverview } from "@pulse/api-client";
import { overviewObservations } from "../lib/overview-observations.js";
import { RecordIcon } from "./record-icon.js";
import { PhysiologicalSummary } from "./physiological-summary.js";

const metrics = [
  { code: "blood-pressure", label: "Blood pressure", icon: "pressure" },
  { code: "heart-rate", label: "Heart rate", icon: "heart" },
  { code: "temperature", label: "Temperature", icon: "temperature" },
  { code: "respiratory-rate", label: "Respiratory rate", icon: "lungs" },
  { code: "spo2", label: "Oxygen saturation", icon: "oxygen" },
  { code: "weight", label: "Weight", icon: "weight" },
  { code: "height", label: "Height", icon: "height" },
];
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function LatestVitalSigns({ observations, onHistory }: {
  observations: StaffChartOverview["observations"];
  onHistory: () => void;
}) {
  const measured = overviewObservations(observations.items);
  const visible = metrics.flatMap((metric) => {
    const matches = measured.filter((item) => item.code === metric.code || (metric.code === "blood-pressure" && item.code.startsWith("bp-")));
    return matches.length ? matches.map((item) => ({ ...item, label: item.code === "bp-systolic" ? "Systolic BP" : item.code === "bp-diastolic" ? "Diastolic BP" : metric.label, icon: metric.icon })) : [{ id: metric.code, code: metric.code, label: metric.label, icon: metric.icon, value: null, unit: null, takenAt: "", origin: "", assessment: undefined }];
  });
  const latest = observations.items.map((item) => item.takenAt).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const differentTimes = new Set(observations.items.map((item) => item.takenAt)).size > 1;
  const flagged = visible.filter((item) => item.assessment?.status === "urgent" || item.assessment?.status === "attention");
  return <section className="record-panel latest-vitals" aria-labelledby="latest-vitals-title">
    <div className="latest-vitals__heading"><div><h2 id="latest-vitals-title"><RecordIcon kind="vitals" />Latest vital signs</h2>{observations.access === "available" && latest ? <span className="latest-vitals__updated">Latest entry <time dateTime={latest}>{formatDate(latest)}</time></span> : null}</div>{observations.access === "available" ? <button onClick={onHistory}>View history <span aria-hidden="true">→</span></button> : null}</div>
    {observations.access === "restricted" ? <p className="latest-vitals__restricted">Your current permissions do not include vital signs.</p> : <>
      {flagged.length ? <p className="latest-vitals__review"><RecordIcon kind="allergy" size={14} />{flagged.length} {flagged.length === 1 ? "measurement needs" : "measurements need"} review <span>Adult screening signals</span></p> : null}
      <dl className="latest-vitals__strip">{visible.map((item) => <div className={`latest-vitals__metric latest-vitals__metric--${item.assessment?.status ?? "unassessed"}${item.value === null ? " latest-vitals__metric--missing" : ""}`} key={item.id}>
        <dt><span className="latest-vitals__metric-icon"><RecordIcon kind={item.icon} size={18} /></span><span>{item.label}</span></dt>
        <dd><strong>{item.value ?? "—"}</strong>{item.value !== null && item.unit ? <span className="latest-vitals__unit">{item.unit}</span> : null}</dd>
        {item.value !== null ? <span className={`latest-vitals__flag latest-vitals__flag--${item.assessment?.status ?? "not-assessed"}`} title={item.assessment?.reason ?? "No assessment is available for this measurement."}>{["urgent", "attention"].includes(item.assessment?.status ?? "") ? <span aria-hidden="true">!</span> : null}{item.assessment?.label ?? "Not assessed"}</span> : null}
        {item.assessment?.referenceRange ? <small className="latest-vitals__reference-note">{item.assessment.referenceLabel}: {item.assessment.referenceRange}</small> : null}
        {item.value === null ? <small>{item.takenAt ? "Value not recorded" : "Not recorded"}</small> : differentTimes ? <time title={formatDate(item.takenAt)} dateTime={item.takenAt}>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(item.takenAt))}</time> : null}
      </div>)}</dl>
      <div className="latest-vitals__footer"><p>{observations.items.length ? differentTimes ? "Latest per measure · recorded at different times" : "Latest recorded measurements" : "No vital signs recorded yet"}</p>{observations.items.length ? <details className="latest-vitals__details"><summary>Measurements & flags</summary><div><p>Adult screening references; not a diagnosis or a complete early-warning score. SpO2 uses the default reference, not a prescribed oxygen target. Pregnancy, symptoms and paediatric rules require separate clinical assessment. Readings may be from different visits.</p><ul>{measured.map((item) => <li key={item.id}><strong>{metrics.find((metric) => metric.code === item.code)?.label ?? item.code.replaceAll("-", " ")}</strong><span>{item.value ?? "Value not recorded"} {item.unit ?? "(unit not recorded)"}</span><time dateTime={item.takenAt}>{formatDate(item.takenAt)}</time><small>Source: {item.origin || "Not recorded"}</small><div className="latest-vitals__reason"><strong>{item.assessment?.label ?? "Not assessed"}</strong><p>{item.assessment?.reason ?? "No assessment is available."}</p>{item.assessment ? <small>Rule version: {item.assessment.ruleVersion}{item.assessment.sourceUrl ? <> · <a href={item.assessment.sourceUrl} target="_blank" rel="noreferrer">Reference guidance</a></> : null}</small> : null}</div></li>)}</ul></div></details> : null}</div>
      <PhysiologicalSummary observations={observations} />
    </>}
  </section>;
}
