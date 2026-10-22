"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button} from '@pulse/ui';
import {ApiError,createStaffWebApi,type StaffProblemContext,type StaffProblemEntry} from '@pulse/api-client';
import {SettingsDrawer} from './settings-drawer.js';
const api=createStaffWebApi();
export function ProblemEntryDrawer({patientId,patientName,mrn,entryId,onClose,onSaved}:{patientId:string;patientName:string;mrn:string|null;entryId?:string;onClose:()=>void;onSaved:()=>void}) {
  const [contexts,setContexts]=useState<StaffProblemContext[]>([]),[entry,setEntry]=useState<StaffProblemEntry|null>(null),[encounterId,setEncounterId]=useState('');
  const [verificationStatus,setVerificationStatus]=useState<'provisional'|'confirmed'|'differential'>('provisional');
  const [kind,setKind]=useState<'problem'|'diagnosis'>('diagnosis'),[display,setDisplay]=useState(''),[reason,setReason]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[discard,setDiscard]=useState(false),[retry,setRetry]=useState(0);
  const command=useRef({hash:'',key:''}),discardRef=useRef<HTMLDivElement>(null);
  const dirty=Boolean(display.trim()||reason.trim());
  useEffect(()=>{if(discard)discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();},[discard]);
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(null);
    Promise.all([api.problemContexts(patientId,controller.signal),entryId?api.problemEntry(patientId,entryId,controller.signal):Promise.resolve(null)]).then(([available,current])=>{
      if(controller.signal.aborted)return;setContexts(available);setEntry(current);setEncounterId(available[0]?.encounterId??'');
    }).catch(err=>{if(!controller.signal.aborted)setError(err instanceof ApiError?err.message:'Could not load the problem-list workspace.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[patientId,entryId,retry]);
  async function submit() {
    if(!encounterId||!contexts.some(c=>c.encounterId===encounterId))return;
    const payload=entryId?{encounterId,expectedVersion:entry?.version??0,reason:reason.trim()}:{encounterId,kind,verificationStatus,display:display.trim()};
    const hash=JSON.stringify(payload);if(command.current.hash!==hash)command.current={hash,key:crypto.randomUUID()};
    setBusy(true);setError(null);
    try {
      if(entryId)await api.resolveProblem(patientId,entryId,{encounterId,expectedVersion:entry!.version,reason:reason.trim(),commandKey:command.current.key});
      else await api.createProblem(patientId,{encounterId,kind,verificationStatus,display:display.trim(),commandKey:command.current.key});
      onSaved();onClose();
    } catch(err){setError(err instanceof ApiError?err.message:'Could not save. Your entered text is still here.');}finally{setBusy(false);}
  }
  const eligible=!loading&&contexts.length>0&&(!entryId||(entry?.status==='active'&&entry.origin==='local'));
  return <SettingsDrawer className="problem-entry-drawer" id="problem-entry-drawer" title={entryId?'Resolve problem or diagnosis':'Add problem or diagnosis'} description={entryId?'Record a clinical resolution while preserving the original entry.':'Add an authored entry to the patient’s longitudinal problem list.'} busy={busy} onClose={onClose} onBeforeClose={()=>{if(dirty){setDiscard(true);return false;}return true;}} footerActions={<Button disabled={busy||!eligible||!encounterId||(entryId?reason.trim().length<3:display.trim().length<3)} onClick={()=>void submit()}>{busy?'Saving…':entryId?'Confirm resolution':'Add to problem list'}</Button>}>
    <div className="note-patient-context"><div><strong>{patientName}</strong><small>MRN {mrn??'Not recorded'}</small></div><span>{entryId?'Clinical resolution':'New entry'}</span></div>
    {loading?<p role="status">Loading assigned encounters…</p>:null}
    {error?<Alert tone="error">{error}{!contexts.length?<button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button>:null}</Alert>:null}
    {discard?<div className="note-discard-warning" role="alert" ref={discardRef}><strong>Discard unsaved changes?</strong><p>Your entered text has not been saved.</p><div><Button variant="secondary" onClick={()=>setDiscard(false)}>Keep editing</Button><Button onClick={onClose}>Discard changes</Button></div></div>:null}
    {!loading&&!contexts.length&&!error?<Alert tone="info">Start your assigned consultation from Staff worklists before updating the problem list.</Alert>:null}
    {entryId&&entry?<section className="problem-entry-original"><span className="record-eyebrow">Original entry · {entry.kind}</span><h3>{entry.display}</h3><p>Recorded {new Date(entry.recordedAt).toLocaleString()} · {entry.origin}</p><span className={`record-status record-status--${entry.status}`}>{entry.status}</span></section>:null}
    {entryId&&entry&&!eligible&&!loading&&contexts.length?<Alert tone="info">This entry is already resolved or was recorded externally. It cannot be resolved here.</Alert>:null}
    {eligible?<div className="workflow-form problem-entry-form">
      {contexts.length===1?<div className="problem-entry-context"><span>Documenting encounter</span><strong>{contexts[0]!.type} · {new Date(contexts[0]!.startedAt).toLocaleString()}</strong></div>:<label>Encounter<select value={encounterId} disabled={busy} onChange={e=>setEncounterId(e.target.value)}>{contexts.map(c=><option key={c.encounterId} value={c.encounterId}>{c.type} · {new Date(c.startedAt).toLocaleString()}</option>)}</select></label>}
      {entryId?<><label>Resolution reason<textarea name="resolutionReason" value={reason} maxLength={2000} rows={5} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Document why this entry is being marked resolved."/></label><small>The original description, author and recording date are retained. Resolution does not delete the entry or complete the encounter.</small></>:<><fieldset className="problem-entry-kind"><legend>Entry type</legend>{(['diagnosis','problem'] as const).map(value=><label key={value}><input type="radio" name="problemKind" value={value} checked={kind===value} disabled={busy} onChange={()=>setKind(value)}/><span><strong>{value==='diagnosis'?'Diagnosis':'Ongoing problem'}</strong><small>{value==='diagnosis'?'A diagnosis documented during care':'An issue requiring longitudinal follow-up'}</small></span></label>)}</fieldset><label>Verification status<select name="verificationStatus" value={verificationStatus} disabled={busy} onChange={e=>setVerificationStatus(e.target.value as typeof verificationStatus)}><option value="provisional">Provisional</option><option value="confirmed">Confirmed</option><option value="differential">Differential</option></select></label><label>Clinical description<textarea name="problemDescription" value={display} maxLength={300} rows={3} disabled={busy} onChange={e=>setDisplay(e.target.value)} placeholder="Enter the problem or diagnosis you have assessed."/></label><small>{display.length}/300 · Saved as an uncoded clinical entry. This does not update a signed note, allergy record or billing code.</small></>}
    </div>:null}
  </SettingsDrawer>;
}
