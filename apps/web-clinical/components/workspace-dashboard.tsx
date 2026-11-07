"use client";
import {useEffect,useState} from 'react';
import {ApiError,createStaffWebApi} from '@pulse/api-client';
import type {PublicSession} from '../lib/session.js';
import {workflowStatusLabel} from '../lib/workflow-language.mjs';
import {loadCriticalCounts} from '../lib/critical-counts.js';
import {worklistTabs,canUseCriticalResults} from '../lib/workspace-navigation.mjs';
import {AppointmentsIcon,NursingIcon,ClinicalIcon,LaboratoryIcon,ImagingIcon,BellIcon,DashboardIcon} from './nav-icons.js';
import {stageLabels} from './visit-actions.js';
const api=createStaffWebApi();
type Facility=NonNullable<PublicSession['facility']>;
type Row={href:string;action:string;id:string;name:string;mrn:string|null;status:string;time:string;detail:string};
type Queue={rows:Row[];count:number;bounded:boolean;updated:string};
const icons={radiology:ImagingIcon,reception:AppointmentsIcon,vitals:NursingIcon,consultation:ClinicalIcon,laboratory:LaboratoryIcon};
const descriptions:Record<string,string>={radiology:'Review incoming imaging requests and their clinical context.',reception:'Check in patients and follow their visit.',vitals:'Record observations and prepare the clinical handover.',consultation:'Review assigned patients and continue their care.',laboratory:'Track requests, specimens and reports awaiting review.'};
export function WorkspaceDashboard({facility}:{facility:Facility;loginId:string}){
 const tabs=worklistTabs(facility.privileges);
 const [selected,setSelected]=useState(tabs[0]?.id??'');
 const [queues,setQueues]=useState<Record<string,Queue>>({});
 const [errors,setErrors]=useState<Record<string,boolean>>({});
 const [critical,setCritical]=useState<{pending:number;overdue:number}|null>(null);
 const [inbox,setInbox]=useState<Awaited<ReturnType<typeof api.notifications>>|null>(null);
 const [refresh,setRefresh]=useState(0),[busy,setBusy]=useState(true),[date,setDate]=useState('');
 const criticalAllowed=canUseCriticalResults(facility.privileges);
 useEffect(()=>{
  setDate(new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}));
  const controller=new AbortController();let running=false;
  async function load(){
   if(running||document.hidden)return;running=true;setBusy(true);
   async function read(key:string,action:()=>Promise<void>){try{await action();if(!controller.signal.aborted)setErrors(e=>({...e,[key]:false}));}catch(err){if(controller.signal.aborted)return;if(err instanceof ApiError&&err.status===401){window.location.assign('/login');return;}setErrors(e=>({...e,[key]:true}));}}
   await Promise.allSettled([
    ...tabs.map(tab=>read(tab.id,async()=>{
     let result:Queue;
     if(tab.id==='radiology'){
      const page=await api.radiologyQueue('all','',undefined,controller.signal);
      result={count:Object.values(page.counts).reduce((a,b)=>a+b,0),bounded:false,updated:page.fetchedAt,rows:page.items.map(item=>({href:`/worklists?queue=${tab.id}&order=${item.id}`,action:'Continue request',id:item.id,name:`${item.patient.givenName} ${item.patient.familyName}`,mrn:item.patient.mrn,status:item.status,time:item.orderedAt,detail:item.procedureName}))};
     }else if(tab.id==='laboratory'){
      const page=await api.labQueue('all','',undefined,controller.signal);
      result={count:Object.values(page.counts).reduce((a,b)=>a+b,0),bounded:false,updated:page.fetchedAt,rows:page.items.map(item=>({href:`/worklists?queue=${tab.id}&order=${item.id}`,action:'Continue request',id:item.id,name:`${item.patient.givenName} ${item.patient.familyName}`,mrn:item.patient.mrn,status:item.status,time:item.orderedAt,detail:item.test.name}))};
     }else{
      const rows=await api.visits(tab.id,controller.signal);
      result={count:rows.length,bounded:rows.length===100,updated:new Date().toISOString(),rows:rows.map(item=>({href:tab.id==='consultation'?`/patients/${item.patient.id}`:`/worklists?queue=${tab.id}`,action:tab.id==='consultation'?(item.stage==='waiting-consultation'?'Open consultation':'Continue consultation'):'Continue care',id:item.id,name:`${item.patient.givenName} ${item.patient.familyName}`,mrn:item.patient.mrn,status:item.stage,time:item.checkedInAt,detail:stageLabels[item.stage]}))};
     }
     if(!controller.signal.aborted)setQueues(q=>({...q,[tab.id]:result}));
    })),
    read('inbox',async()=>{const page=await api.notifications({unread:true,signal:controller.signal});if(!controller.signal.aborted)setInbox(page);}),
    ...(criticalAllowed?[read('critical',async()=>{const counts=await loadCriticalCounts(facility.privileges,controller.signal);if(!controller.signal.aborted)setCritical(counts);})]:[]),
   ]);
   running=false;if(!controller.signal.aborted)setBusy(false);
  }
  void load();const timer=setInterval(()=>void load(),30000);const focus=()=>void load();window.addEventListener('focus',focus);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
 },[facility.facilityId,refresh]);
 const queue=queues[selected],tab=tabs.find(t=>t.id===selected);
 const primary=tabs.find(t=>t.id==='consultation')??tabs[0];
 return <div className="workspace-dashboard">
  <header className="workspace-heading"><div><span className="workspace-eyebrow">{facility.facilityName}</span><h1>{tabs.length===1?({consultation:'Your consultations',laboratory:'Laboratory workspace',vitals:'Nursing workspace',reception:'Reception',radiology:'Radiology workspace'} as Record<string,string>)[tabs[0]!.id]??'Your workspace':'Your workspace'}</h1><p>{date||'Your daily care and operations overview'}</p></div><button className="workspace-refresh" onClick={()=>setRefresh(n=>n+1)} disabled={busy}><span aria-hidden="true">↻</span>{busy?'Updating…':'Refresh'}</button></header>
  <div className="workspace-start"><p>{primary?descriptions[primary.id]:'Your assigned updates and available work areas.'}</p><a className="workspace-primary" href={primary?`/worklists?queue=${primary.id}`:'/notifications'}>{primary?.id==='consultation'?'See your patients':primary?.id==='laboratory'?'Open lab requests':primary?`Open ${primary.label.toLowerCase()}`:'Open notifications'} <span aria-hidden="true">?</span></a></div>
  <section className="workspace-metrics" aria-label="Current workload">
   {tabs.map(item=>{const Icon=icons[item.id as keyof typeof icons];const data=queues[item.id];return <a href={`/worklists?queue=${item.id}`} className="workspace-metric" key={item.id}><span className={`workspace-icon workspace-icon--${item.id}`}><Icon size={20}/></span><span className="workspace-metric__label">{item.label}</span><strong>{errors[item.id]?'—':data?`${data.count}${data.bounded?'+':''}`:'…'}</strong><small>{errors[item.id]?'Unavailable · open to retry':['laboratory','radiology'].includes(item.id)?'Pending requests':'Active visits · up to 100'}</small></a>;})}
   {criticalAllowed?<a href="/critical-results" className={`workspace-metric ${!errors.critical&&critical?.pending?'workspace-metric--attention':''}`}><span className="workspace-icon workspace-icon--critical"><NursingIcon size={20}/></span><span className="workspace-metric__label">Critical follow-up</span><strong>{errors.critical?'—':critical?.pending??'…'}</strong><small>{errors.critical?'Unavailable · open to retry':critical?.overdue?`${critical.overdue} past due`:'Pending acknowledgement'}</small></a>:null}
   <a href="/notifications" className="workspace-metric"><span className="workspace-icon workspace-icon--inbox"><BellIcon size={20}/></span><span className="workspace-metric__label">Unread updates</span><strong>{errors.inbox?'—':inbox?.unreadCount??'…'}</strong><small>{errors.inbox?'Unavailable · open to retry':'Your assigned notifications'}</small></a>
  </section>
  <div className="workspace-columns"><div className="workspace-main">
   <section className="workspace-panel"><div className="workspace-panel__head"><div><span className="workspace-eyebrow">Care & operations</span><h2>{tabs.length?'Your active work':'Available work areas'}</h2></div>{tab?<a href={`/worklists?queue=${selected}`}>Full worklist ↗</a>:null}</div>
    {tabs.length?<><div className="workspace-tabs" role="group" aria-label="Choose worklist">{tabs.map(item=><button key={item.id} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>{item.label}</button>)}</div>{errors[selected]?<div className="workspace-empty" role="status"><h3>This worklist could not refresh</h3><p>Open the full worklist or refresh to try again.</p></div>:!queue?<div className="workspace-empty" role="status">Loading your worklist…</div>:queue.rows.length?<div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Patient</th><th>{['laboratory','radiology'].includes(selected)?'Request':'Visit stage'}</th><th>{['laboratory','radiology'].includes(selected)?'Requested':'Checked in'}</th><th><span className="sr-only">Open workflow</span></th></tr></thead><tbody>{queue.rows.slice(0,6).map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>MRN {row.mrn??'Not recorded'}</small></td><td>{['laboratory','radiology'].includes(selected)?<small>{row.detail}</small>:null}<span className={`workspace-status workspace-status--${row.status}`}>{stageLabels[row.status as keyof typeof stageLabels]??workflowStatusLabel(row.status)}</span></td><td><time dateTime={row.time}>{new Date(row.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></td><td><a href={`/worklists?queue=${selected}`} aria-label={`Open ${tab?.label} worklist`}>Open →</a></td></tr>)}</tbody></table></div>:<div className="workspace-empty"><span className="workspace-empty__icon"><DashboardIcon size={30}/></span><h3>No active work in this queue</h3><p>{selected==='consultation'?'Assigned consultations appear here after clinical handover.':selected==='radiology'?'New imaging requests appear here when placed.':selected==='laboratory'?'New lab requests appear here when placed.':'Checked-in patients appear as they move through this stage.'}</p></div>}<div className="workspace-panel__foot">{queue&&!errors[selected]?`Updated ${new Date(queue.updated).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Showing ${Math.min(6,queue.rows.length)} queue entries`:'Current facility worklist'}<span>Refreshes every 30 seconds</span></div></>:<div className="workspace-empty"><DashboardIcon size={30}/><h3>Your workspace is ready</h3><p>Review assigned updates in notifications. Department work areas appear when available for your facility permissions.</p><a href="/notifications">View notifications →</a></div>}
   </section>
   <details className="workspace-guide"><summary>How this workspace works</summary>{primary?.id==='consultation'?<ol><li>Open a patient from your consultation list.</li><li>Review the patient, then record your consultation note.</li><li>Request tests when needed. Use Tests & results in the patient record to review released findings.</li></ol>:primary?.id==='laboratory'?<ol><li>Open a lab request and collect or receive the sample.</li><li>Run the test and record all requested results.</li><li>A different verifier reviews and releases the report to the patient chart.</li></ol>:<ol><li>Open your worklist and select the patient or request.</li><li>Complete the current step using the actions provided.</li><li>Check the next responsible team before leaving the record.</li></ol>}</details>
  </div><aside className="workspace-rail" aria-label="Updates and workspace details">
   {criticalAllowed?<section className={`workspace-panel workspace-attention ${!errors.critical&&critical?.pending?"workspace-attention--pending":""}`}><div className="workspace-panel__head"><h2><NursingIcon size={19}/>Requires attention</h2></div><div className="workspace-attention__body"><strong>{errors.critical?'Follow-up unavailable':critical?.pending?`${critical.pending} critical follow-up${critical.pending===1?'':'s'}`:critical?'No pending critical follow-up':'Checking follow-up…'}</strong><p>{errors.critical?'Open the follow-up worklist to retry.':critical?.pending?'Review the finding and complete the required communication or acknowledgement.':'Assigned critical findings will appear here for review.'}</p><a href="/critical-results">Open critical follow-up →</a></div></section>:null}
   <section className="workspace-panel"><div className="workspace-panel__head"><h2><BellIcon size={19}/>Latest updates</h2><a href="/notifications">View all</a></div><div className="workspace-updates">{errors.inbox?<p role="status">Updates could not refresh. Open notifications to retry.</p>:!inbox?<p>Loading updates…</p>:inbox.items.length?inbox.items.slice(0,4).map(item=><a key={item.id} href="/notifications"><span className="workspace-update-dot"/><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></span><span aria-hidden="true">›</span></a>):<div className="workspace-updates__empty"><BellIcon size={26}/><strong>You’re up to date</strong><p>No unread notifications.</p></div>}</div></section>
   <section className="workspace-panel workspace-context"><span className="workspace-eyebrow">Current workspace</span><h3>{facility.facilityName}</h3><p>{facility.organizationName}</p><div>{facility.roles.map(role=><span key={role}>{role.replaceAll('_',' ')}</span>)}</div><small>Work areas reflect your access at this facility.</small></section>
  </aside></div>
 </div>;
}
