"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button} from '@pulse/ui';
import {CriticalFollowup} from './critical-followup.js';
import {ApiError,createStaffWebApi,type StaffLabDutyOrder} from '@pulse/api-client';
const api=createStaffWebApi();
const localNow=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);};
export function LabResultEditor({order,privileges,onDirty,onBusy,onSaved}:{order:StaffLabDutyOrder;privileges:string[];onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onSaved:(v:StaffLabDutyOrder)=>void}){
  const [component,setComponent]=useState(''),[value,setValue]=useState(''),[unit,setUnit]=useState(''),[flag,setFlag]=useState(''),[time,setTime]=useState(localNow),[attested,setAttested]=useState(false),[review,setReview]=useState(false),[verify,setVerify]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const [criticalReady,setCriticalReady]=useState(false),[criticalPinned,setCriticalPinned]=useState(false),[criticalDirty,setCriticalDirty]=useState(false),[componentDirty,setComponentDirty]=useState(false),[criticalBusy,setCriticalBusy]=useState(false);
  useEffect(()=>onDirty(componentDirty||criticalDirty),[componentDirty,criticalDirty,onDirty]);
  useEffect(()=>onBusy(busy||criticalBusy),[busy,criticalBusy,onBusy]);
  const command=useRef({hash:'',key:''}),initialTime=useRef(time);
  const rows=order.results??[],final=order.status==='verified';
  const canEnter=!final&&!criticalPinned&&['accessioned','resulted'].includes(order.status)&&privileges.includes('lab:result')&&order.patient.status==='active';
  const critical=rows.some(r=>r.flag==='critical'),missingProvenance=rows.some(r=>!r.recordedBy||!r.effectiveAt||r.source!=='manual-bench');
  const canVerify=order.status==='resulted'&&privileges.includes('lab:verify')&&rows.length>0&&(!critical||criticalReady)&&!missingProvenance;
  const ready=component.trim()&&value.trim()&&time&&Number.isFinite(new Date(time).getTime())&&attested;
  function changed(){setComponentDirty(true);onDirty(true);setMessage(null);}
  async function save(finalise:boolean){
    if(!attested||(!finalise&&!ready))return;
    setBusy(true);setError(null);
    const payload=finalise?{expectedVersion:order.version,attestation:true as const}:{expectedVersion:order.version,component:component.trim(),value:value.trim(),unit:unit.trim(),flag:(flag||null) as 'normal'|'high'|'low'|'critical'|null,effectiveAt:new Date(time).toISOString(),attestation:true as const};
    const hash=JSON.stringify({finalise,...payload});if(command.current.hash!==hash)command.current={hash,key:crypto.randomUUID()};
    try{
      const result=finalise?await api.verifyLabResults(order.id,{expectedVersion:order.version,attestation:true,commandKey:command.current.key}):await api.stageLabResult(order.id,{expectedVersion:order.version,component:component.trim(),value:value.trim(),unit:unit.trim(),flag:(flag||null) as 'normal'|'high'|'low'|'critical'|null,effectiveAt:new Date(time).toISOString(),attestation:true,commandKey:command.current.key});
      setComponent('');setValue('');setUnit('');setFlag('');const now=localNow();initialTime.current=now;setTime(now);setAttested(false);setReview(false);setVerify(false);setComponentDirty(false);onDirty(criticalDirty);onSaved(result);setMessage(finalise?'Report verified and published to the patient chart.':'Component saved for laboratory review. It is not published to the patient chart.');
    }catch(e){setError(e instanceof ApiError?e.message:'Could not save. Your entered information is kept.');}finally{setBusy(false);}
  }
  return <section className="lab-results" aria-label="Laboratory results">
    <div className="lab-results__heading"><div><span className="record-eyebrow">{final?'Final report':'Manual bench results'}</span><h3>{final?'Verified findings':'Result entry & review'}</h3></div><span className={`clinical-summary__pill clinical-summary__pill--${final?'neutral':'warning'}`}>{final?'Published':'Not released'}</span></div>
    {error?<Alert tone="error">{error}</Alert>:null}{message?<p role="status" className="note-save-message">{message}</p>:null}
    {critical?<Alert tone="error">Critical result recorded. Confirm, communicate and obtain explicit acknowledgement before final release. Follow the facility’s direct escalation procedure.</Alert>:null}
    {rows.length?<ul className="lab-results__list">{rows.map(r=><li key={r.id}><div><strong>{r.component}</strong><span className={`clinical-summary__pill clinical-summary__pill--${r.flag==='critical'?'critical':r.flag==='high'||r.flag==='low'?'warning':'neutral'}`}>{r.flag??'Interpretation not supplied'}</span></div><p className="lab-results__value">{r.value} <small>{r.unit??'Unit not supplied'}</small></p><small>Revision {r.version} · {r.recordedByLabel??'Author not recorded'} · {new Date(r.recordedAt).toLocaleString()}</small><small>Measured {r.effectiveAt?new Date(r.effectiveAt).toLocaleString():'Time not recorded'} · {r.source==='manual-bench'?'Manual bench entry':'Source not recorded'}</small></li>)}</ul>:<p className="workflow-hint">No result components entered.</p>}
    {critical&&!final?<CriticalFollowup orderId={order.id} orderVersion={order.version} privileges={privileges} onDirty={v=>{setCriticalDirty(v);onDirty(v||componentDirty);}} onBusy={v=>{setCriticalBusy(v);onBusy(v||busy);}} onReady={setCriticalReady} onPinned={setCriticalPinned} showResults={false}/>:null}
    {final?<p className="workflow-hint">Verified {order.verification?.at?new Date(order.verification.at).toLocaleString():''} · {order.verification?.byLabel??'Verifier not recorded'}. Final findings are locked. Corrections require a governed amendment.</p>:null}
    {canEnter&&!verify?<div className="workflow-form problem-entry-form">
      <h4>{review?'Review component':'Add or revise a component'}</h4>
      <p className="workflow-hint">Record the actual bench finding and unit. Reusing a component name creates a new revision; the previous record is retained. Reference intervals and panel completeness are not automatically checked in this workflow.</p>
      {review?<dl className="record-field-list"><div><dt>Component</dt><dd>{component}</dd></div><div><dt>Result</dt><dd>{value} {unit}</dd></div><div><dt>Interpretation</dt><dd>{flag||'Not supplied'}</dd></div><div><dt>Measured</dt><dd>{new Date(time).toLocaleString()}</dd></div></dl>:<>
        <label>Component<input name="resultComponent" maxLength={100} value={component} disabled={busy||criticalBusy} onChange={e=>{changed();setComponent(e.target.value);}} placeholder="Exact component name" list="lab-component-names"/><datalist id="lab-component-names">{rows.map(r=><option key={r.id} value={r.component}/>)}</datalist></label>
        <label>Result<textarea name="resultValue" rows={2} maxLength={2000} value={value} disabled={busy} onChange={e=>{changed();setValue(e.target.value);}}/></label>
        <div className="lab-results__fields"><label>Unit<input name="resultUnit" maxLength={50} value={unit} disabled={busy} onChange={e=>{changed();setUnit(e.target.value);}} placeholder="If applicable"/></label><label>Interpretation<select name="resultFlag" value={flag} disabled={busy} onChange={e=>{changed();setFlag(e.target.value);}}><option value="">Not supplied</option><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option><option value="critical">Critical</option></select></label></div>
        <label>Actual measurement time<input name="resultEffectiveAt" type="datetime-local" step="1" value={time} disabled={busy} onChange={e=>{changed();setTime(e.target.value);}}/></label>
        <label className="lab-order-attestation"><input name="resultAttestation" type="checkbox" checked={attested} disabled={busy} onChange={e=>{changed();setAttested(e.target.checked);}}/><span>I checked the patient, accession, component, value, unit and interpretation against the bench record.</span></label>
      </>}
      <div className="lab-results__actions">{review?<><Button variant="secondary" disabled={busy} onClick={()=>setReview(false)}>Back to component</Button><Button disabled={busy} onClick={()=>void save(false)}>{busy?'Saving…':'Save for verification'}</Button></>:<Button disabled={!ready||busy} onClick={()=>setReview(true)}>Review component</Button>}</div>
    </div>:null}
    {canVerify?<section className="lab-results__verification"><h4>Final report verification</h4><p>A separate authorised verifier must check the complete report against the source records and facility validation procedure. Verification publishes all displayed components; it does not record clinician review.</p><label className="lab-order-attestation"><input name="verificationAttestation" type="checkbox" checked={verify&&attested} disabled={busy||criticalBusy||Boolean(component||value||unit||flag||time!==initialTime.current)} onChange={e=>{changed();setVerify(e.target.checked);setAttested(e.target.checked);}}/><span>I independently reviewed the complete report, specimen identity, units, interpretations and required laboratory checks. This report is ready for release.</span></label><Button disabled={!verify||!attested||busy} onClick={()=>void save(true)}>{busy?'Publishing…':'Verify & publish report'}</Button></section>:null}
  </section>;
}
