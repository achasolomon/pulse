"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button} from '@pulse/ui';
import {ApiError,createStaffWebApi,type StaffLabTest,type StaffLabOrder,type StaffProblemContext} from '@pulse/api-client';
import {SettingsDrawer} from './settings-drawer.js';
const api=createStaffWebApi();
const priority={routine:'Routine',urgent:'Urgent',stat:'STAT'};
export function LabOrderDrawer({patientId,patientName,mrn,orderId,privileges,onClose,onSaved}:{patientId:string;patientName:string;mrn:string|null;orderId?:string;privileges:string[];onClose:()=>void;onSaved:(order:StaffLabOrder)=>void}){
  const [contexts,setContexts]=useState<StaffProblemContext[]>([]),[encounterId,setEncounterId]=useState(''),[order,setOrder]=useState<StaffLabOrder|null>(null),[selected,setSelected]=useState<StaffLabTest|null>(null);
  const [query,setQuery]=useState(''),[catalogue,setCatalogue]=useState<{items:StaffLabTest[];hasMore:boolean}|null>(null),[catalogueError,setCatalogueError]=useState<string|null>(null),[searching,setSearching]=useState(false),[retry,setRetry]=useState(0);
  const [indication,setIndication]=useState(''),[urgency,setUrgency]=useState<StaffLabOrder['urgency']>('routine'),[reason,setReason]=useState(''),[attestation,setAttestation]=useState(false);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[review,setReview]=useState(false),[discard,setDiscard]=useState(false);
  const command=useRef({hash:'',key:''}),discardRef=useRef<HTMLDivElement>(null);
  const dirty=Boolean(selected||indication||reason||attestation||urgency!=='routine');
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{if(discard)discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();},[discard]);
  useEffect(()=>{
    const c=new AbortController();setLoading(true);setError(null);
    const load=orderId?api.labOrder(patientId,orderId,c.signal).then(r=>{if(!c.signal.aborted)setOrder(r);}):api.labContexts(patientId,c.signal).then(r=>{if(!c.signal.aborted){setContexts(r);setEncounterId(r[0]?.encounterId??'');}});
    load.catch(e=>{if(!c.signal.aborted)setError(e instanceof ApiError?e.message:'Could not load the laboratory workspace.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[patientId,orderId,retry]);
  useEffect(()=>{
    if(orderId||loading||!contexts.length)return;
    const c=new AbortController();setCatalogue(null);setCatalogueError(null);
    if(query.trim().length===1){setSearching(false);return;}
    setSearching(true);const timer=setTimeout(()=>{api.labCatalogue(patientId,query,c.signal).then(r=>{if(!c.signal.aborted)setCatalogue(r);}).catch(e=>{if(!c.signal.aborted)setCatalogueError(e instanceof ApiError?e.message:'Could not load the facility catalogue.');}).finally(()=>{if(!c.signal.aborted)setSearching(false);});},250);
    return()=>{c.abort();clearTimeout(timer);};
  },[patientId,orderId,loading,contexts.length,query,retry]);
  const canCancel=Boolean(order?.status==='ordered'&&privileges.includes('lab:cancel')&&privileges.includes('encounter:consult'));
  const ready=orderId?canCancel&&reason.trim().length>=3:Boolean(selected&&encounterId&&contexts.some(c=>c.encounterId===encounterId)&&indication.trim().length>=3);
  async function submit(){
    if(!ready||(!orderId&&!attestation))return;setBusy(true);setError(null);
    const payload=orderId?{id:orderId,expectedVersion:order!.version,reason:reason.trim()}:{encounterId,testId:selected!.id,testVersion:selected!.version,urgency,indication:indication.trim()};
    const hash=JSON.stringify(payload);if(command.current.hash!==hash)command.current={hash,key:crypto.randomUUID()};
    try{
      const result=orderId?await api.cancelLabOrder(patientId,orderId,{expectedVersion:order!.version,reason:reason.trim(),commandKey:command.current.key}):await api.placeLabOrder(patientId,{encounterId,testId:selected!.id,testVersion:selected!.version,urgency,indication:indication.trim(),attestation:true,commandKey:command.current.key});
      onSaved(result);onClose();
    }catch(e){setError(e instanceof ApiError?e.message:'Could not save. Your entered information is still here.');}finally{setBusy(false);}
  }
  const test=order?.test??selected;
  return <SettingsDrawer id="lab-order-drawer" className="problem-entry-drawer lab-order-drawer" title={orderId?review?'Review cancellation':'Laboratory order':review?'Review laboratory order':'Request a lab test'} description={orderId?'Review the order and its recorded workflow status.':'Choose a test available at this facility and document the clinical indication.'} busy={busy} onClose={onClose} onBeforeClose={()=>{if(dirty){setDiscard(true);return false;}return true;}} footerActions={review?<><Button variant="secondary" disabled={busy} onClick={()=>{setReview(false);setAttestation(false);}}>Back</Button><Button disabled={busy||!ready||(!orderId&&!attestation)} onClick={()=>void submit()}>{busy?'Saving…':orderId?'Confirm cancellation':'Place order'}</Button></>:(!orderId||canCancel)?<Button disabled={busy||loading||!ready} onClick={()=>{setReview(true);setError(null);}}>{orderId?'Review cancellation':'Review order'}</Button>:null}>
    <div className="note-patient-context"><div><strong>{patientName}</strong><small>MRN {mrn??'Not recorded'}</small></div><span>{order?.status??(review?'Final review':'New order')}</span></div>
    {loading?<p role="status">Loading laboratory workspace…</p>:null}
    {error?<Alert tone="error">{error}{!order&&!contexts.length?<button onClick={()=>setRetry(n=>n+1)}>Retry</button>:null}</Alert>:null}
    {discard?<div className="note-discard-warning" role="alert" ref={discardRef}><strong>Discard unsaved changes?</strong><p>Your entered information has not been saved.</p><div><Button variant="secondary" onClick={()=>setDiscard(false)}>Keep editing</Button><Button onClick={onClose}>Discard changes</Button></div></div>:null}
    {!loading&&!orderId&&!contexts.length&&!error?<Alert tone="info">Start your assigned consultation from Staff worklists before ordering laboratory tests.</Alert>:null}
    {review&&test?<section className="lab-order-review" aria-label="Laboratory order review"><span className="record-eyebrow">{orderId?'Cancellation review':'Selected test'}</span><h3>{test.name}</h3><dl className="record-field-list"><div><dt>Catalogue code / version</dt><dd>{test.code} · v{test.version}</dd></div><div><dt>Specimen requirement</dt><dd>{test.specimenRequirement||'Not supplied in the catalogue'}</dd></div><div><dt>Encounter</dt><dd>{order?order.encounter.type+' · '+new Date(order.encounter.startedAt).toLocaleString():contexts.find(c=>c.encounterId===encounterId)?.type+' · '+new Date(contexts.find(c=>c.encounterId===encounterId)!.startedAt).toLocaleString()}</dd></div><div><dt>Urgency</dt><dd>{priority[order?.urgency??urgency]}</dd></div><div><dt>Clinical indication</dt><dd>{order?.indication??indication}</dd></div>{orderId?<div><dt>Cancellation reason</dt><dd>{reason}</dd></div>:null}</dl>{orderId?<Alert tone="warning">This cancels the request before collection starts. If processing has started, contact the laboratory.</Alert>:<label className="lab-order-attestation"><input name="labOrderAttestation" type="checkbox" checked={attestation} disabled={busy} onChange={e=>setAttestation(e.target.checked)}/><span>I reviewed the patient, encounter, test, urgency and clinical indication.</span></label>}</section>:null}
    {!review&&!loading&&order?<div className="workflow-form problem-entry-form"><section className="problem-entry-original"><span className="record-eyebrow">{order.status} · Revision {order.version}</span><h3>{order.test.name}</h3><p>{order.test.code} · Catalogue v{order.test.version}</p><p>Ordered {new Date(order.orderedAt).toLocaleString()} · {order.orderedByLabel??'Ordering staff not recorded'}</p></section><dl className="record-field-list"><div><dt>Clinical indication</dt><dd>{order.indication||'Not recorded'}</dd></div><div><dt>Specimen requirement</dt><dd>{order.test.specimenRequirement||'Not supplied in the catalogue'}</dd></div><div><dt>Urgency</dt><dd>{priority[order.urgency]}</dd></div>{order.cancelReason?<div><dt>Cancellation reason</dt><dd>{order.cancelReason}</dd></div>:null}{order.cancelledAt?<div><dt>Cancelled</dt><dd>{new Date(order.cancelledAt).toLocaleString()} · {order.cancelledByLabel??'Staff not recorded'}</dd></div>:null}</dl>{canCancel?<label>Cancellation reason<textarea name="labCancelReason" rows={3} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/><small>Cancellation here is available only before specimen collection or processing starts.</small></label>:<p className="workflow-hint">This view does not change specimen collection, results or verification.</p>}</div>:null}
    {!review&&!loading&&!orderId&&contexts.length?<div className="workflow-form problem-entry-form">
      {contexts.length===1?<div className="problem-entry-context"><span>Ordering encounter</span><strong>{contexts[0]!.type} · {new Date(contexts[0]!.startedAt).toLocaleString()}</strong></div>:<label>Encounter<select value={encounterId} disabled={busy} onChange={e=>setEncounterId(e.target.value)}>{contexts.map(c=><option key={c.encounterId} value={c.encounterId}>{c.type} · {new Date(c.startedAt).toLocaleString()}</option>)}</select></label>}
      <label>Find a laboratory test<input type="search" name="labCatalogueQuery" value={query} maxLength={100} disabled={busy} onChange={e=>{setQuery(e.target.value);setSelected(null);}} placeholder="Search available tests by name or code"/></label>
      {catalogueError?<Alert tone="error">{catalogueError} <button onClick={()=>setRetry(n=>n+1)}>Retry catalogue</button></Alert>:searching?<p role="status">Searching facility catalogue…</p>:query.trim().length===1?<small>Enter at least two characters to search.</small>:catalogue?.items.length&&!selected?<fieldset className="lab-catalogue-results"><legend className="sr-only">Available laboratory tests</legend>{catalogue.items.map(item=><label key={item.id}><input type="radio" name="labTest" checked={false} disabled={busy} onChange={()=>setSelected(item)}/><span><strong>{item.name}</strong><small>{item.code} · v{item.version}</small><small>{item.specimenRequirement||'Specimen requirements not supplied'}</small></span></label>)}{catalogue.hasMore?<small>Showing 25 matches. Refine the search to find other tests.</small>:null}</fieldset>:catalogue&&!selected?<p className="workflow-hint">No available tests match this search. Facility catalogue approval is required before a test can be ordered.</p>:null}
      {selected?<div className="lab-selected-test"><span>Selected test</span><strong>{selected.name}</strong><small>{selected.code} · v{selected.version}</small><button onClick={()=>setSelected(null)}>Change selection</button></div>:null}
      <label>Urgency<select name="labUrgency" value={urgency} disabled={busy} onChange={e=>setUrgency(e.target.value as typeof urgency)}>{Object.entries(priority).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Clinical indication<textarea name="labIndication" rows={3} maxLength={2000} value={indication} disabled={busy} onChange={e=>setIndication(e.target.value)} placeholder="Why is this investigation being requested?"/></label><small>One test per request. Existing pending requests must be reviewed before repeating the same test.</small>
    </div>:null}
  </SettingsDrawer>;
}
