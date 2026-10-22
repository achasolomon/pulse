"use client";
import { useEffect, useState } from 'react';
import { ApiError, createStaffWebApi, type StaffChartHistoryItem, type StaffChartHistoryPage } from '@pulse/api-client';
import { RecordIcon } from './record-icon.js';
const api = createStaffWebApi();
type Section = 'entries' | 'medications' | 'investigations';
const field = (item: StaffChartHistoryItem, name: string) => item.fields.find((entry) => entry.label === name)?.value;
const names = {entries:'Problems & diagnoses',medications:'Current treatment',investigations:'Recent investigations'};
const tabs = {entries:['Active','Resolved','All'],medications:['Current','Past','All'],investigations:['Recent','Pending','Available']};
const human = (value: string) => ({resulted:'Awaiting verification',final:'Final report',verified:'Verified',held:'On hold'}[value] ?? value.replaceAll('-', ' '));
const date = (value: string) => new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
function eligible(item: StaffChartHistoryItem, section: Section, tab: string) {
  if (section === 'entries') return field(item,'Type') !== 'allergy' && (tab === 'All' || item.status === (tab === 'Active' ? 'active' : 'resolved'));
  if (section === 'medications') return tab === 'All' || ['prescribed','verified','dispensed','held'].includes(item.status) === (tab === 'Current');
  if (tab === 'Available') return !!(item.diagnostic?.results.length || item.diagnostic?.report);
  return tab === 'Recent' || !['verified','final','cancelled'].includes(item.status);
}
export function ClinicalSummaryCards({patientId,privileges,onOpen,onAddProblem,onOrderLab}:{patientId:string;privileges:string[];onOpen:(section:Section)=>void;onAddProblem?:()=>void;onOrderLab?:()=>void}) {
  return <div className="record-clinical-grid clinical-summary-grid">{(['entries','medications','investigations'] as const).map((section)=><ClinicalSummary key={patientId+section} patientId={patientId} section={section} allowed={section === 'entries' ? privileges.includes('entry:read') : section === 'medications' ? privileges.includes('medication:read') : privileges.some(p=>['lab:read','imaging:view'].includes(p))} onOpen={()=>onOpen(section)} onAdd={section==='entries'?onAddProblem:section==='investigations'?onOrderLab:undefined} />)}</div>;
}
function ClinicalSummary({patientId,section,allowed,onOpen,onAdd}:{patientId:string;section:Section;allowed:boolean;onOpen:()=>void;onAdd?:()=>void}) {
  const [page,setPage]=useState<StaffChartHistoryPage|null>(null),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0),[tab,setTab]=useState(tabs[section][0]);
  useEffect(()=>{
    if(!allowed)return;
    const controller=new AbortController();setPage(null);setError(null);
    api.chartHistory(patientId,section,undefined,controller.signal).then(result=>{if(!controller.signal.aborted)setPage(result);}).catch(err=>{if(!controller.signal.aborted)setError(err instanceof ApiError?err.message:'Could not load this summary.');});
    return()=>controller.abort();
  },[patientId,section,allowed,revision]);
  const priority=(item:StaffChartHistoryItem)=>item.diagnostic?.results.some(result=>result.flag==='critical')?2:item.diagnostic?.results.some(result=>result.flag==='high'||result.flag==='low')||item.status==='held'?1:0;
  const items=(page?.items.filter(item=>eligible(item,section,tab))??[]).sort((a,b)=>priority(b)-priority(a));
  return <section className="record-panel record-preview clinical-summary" aria-labelledby={`summary-${section}`}>
    <div className="clinical-summary__heading"><h2 id={`summary-${section}`}><RecordIcon kind={section} size={19}/>{names[section]}</h2>{allowed?<button onClick={onOpen}>View all <span aria-hidden="true">→</span></button>:null}</div>
    {allowed?<div className="clinical-summary__filters" role="group" aria-label={`${names[section]} filters`}>{tabs[section].map(label=><button key={label} aria-pressed={label===tab} onClick={()=>setTab(label)}>{label}{page?<span>{page.items.filter(item=>eligible(item,section,label)).length}{page.nextCursor?'+':''}</span>:null}</button>)}</div>:null}
    {!allowed?<div className="clinical-summary__empty"><RecordIcon kind={section} size={28}/><strong>Access restricted</strong><p>Your facility permissions do not include these records.</p></div>:error?<div className="clinical-summary__empty" role="status"><p>{error}</p><button className="clinical-summary__retry" onClick={()=>setRevision(n=>n+1)}>Retry</button></div>:!page?<p className="clinical-summary__loading" role="status">Loading {names[section].toLowerCase()}…</p>:!items.length?<div className="clinical-summary__empty"><RecordIcon kind={section} size={29}/><strong>{section==='entries'?'No matching diagnoses documented':section==='medications'?'No matching prescriptions':tab==='Available'?'No verified findings available':'No matching investigations'}</strong><p>{page.items.length?'Other statuses may appear in the full history.':'Records added during care will appear here.'}</p></div>:<div className="clinical-summary__list">{items.slice(0,3).map(item=><SummaryItem key={item.id} item={item} section={section}/>)}</div>}
    {allowed&&page?<footer className="clinical-summary__footer"><small>{page.nextCursor?'Latest 25 records · filters apply to this page':`Recent records · ${items.length} match${items.length===1?'':'es'}`}{items.length>3?' · showing 3':''}</small>{onAdd?<button onClick={onAdd}>{section==='entries'?'＋ Add problem or diagnosis':'＋ Order laboratory test'}</button>:null}<button onClick={onOpen}>{section==='entries'?'Review problem list':section==='medications'?'Review treatment history':'Review orders & findings'}<span aria-hidden="true">→</span></button></footer>:null}
  </section>;
}
export function DiagnosticFindings({item}:{item:StaffChartHistoryItem}) {
  const results=item.diagnostic?.results??[];
  return results.length?<ul className="clinical-summary__results">{results.map(result=><li key={result.component}><strong>{result.component}</strong><span>{result.value} {result.unit}</span><span className={`clinical-summary__pill clinical-summary__pill--${result.flag==='critical'?'critical':result.flag==='high'||result.flag==='low'?'warning':'neutral'}`}>{result.flag??'Not assessed'}</span><small>Version {result.version} · {date(result.recordedAt)}</small></li>)}</ul>:item.diagnostic?.report?<><p className="clinical-summary__report">{item.diagnostic.report.text}</p><small>Final report · Version {item.diagnostic.report.version}</small></>:<p className="clinical-summary__secondary">Verified results or a final report are not available in this record.</p>;
}
function SummaryItem({item,section}:{item:StaffChartHistoryItem;section:Section}) {
  const results=item.diagnostic?.results??[];
  const critical=results.some(result=>result.flag==='critical'),abnormal=results.some(result=>result.flag==='high'||result.flag==='low');
  const tone=critical?'critical':abnormal||item.status==='held'?'warning':item.status==='active'?'active':'neutral';
  return <article className="clinical-summary__item"><div className="clinical-summary__item-heading"><h3>{item.title}</h3><span className={`clinical-summary__pill clinical-summary__pill--${tone}`}>{critical?'Critical':abnormal?'Abnormal':human(item.status)}</span></div>
    {section==='entries'?<p className="clinical-summary__secondary">{field(item,'Type')??'Clinical entry'} <span className={`clinical-summary__pill clinical-summary__pill--${field(item,'Verification status')==='confirmed'?'active':field(item,'Verification status')?'warning':'neutral'}`}>{field(item,'Verification status')??'Verification not recorded'}</span>{field(item,'Code')?` · ${field(item,'Code')}`:''}</p>:section==='medications'?<><p className="clinical-summary__dose">{[field(item,'Dose'),field(item,'Route'),field(item,'Frequency')].filter(Boolean).join(' · ')||'Regimen details not recorded'}</p>{item.status==='held'?<p className="clinical-summary__warning">{field(item,'Hold reason')||'Hold reason not recorded'}</p>:null}<p className="clinical-summary__secondary">{field(item,'Recent administrations (up to 10)')?'Administration records available':'No administration in the recent register'}</p></>:<p className="clinical-summary__secondary">{field(item,'Type')??'Investigation'}{field(item,'Urgency')?` · ${field(item,'Urgency')}`:''}</p>}
    <p className="clinical-summary__date">{section==='entries'?'Recorded':'Ordered'} {date(item.occurredAt)}{item.encounter?` · ${item.encounter.type}`:''}</p>
    <details className="clinical-summary__details"><summary>{section==='investigations'&&results.length?'View verified results':section==='investigations'&&item.diagnostic?.report?'Read final report':'Recorded details'}</summary><div>
      {section==='investigations'?<DiagnosticFindings item={item}/>:null}
      <dl>{item.fields.filter(entry=>entry.value).map(entry=><div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>
    </div></details>
  </article>;
}
