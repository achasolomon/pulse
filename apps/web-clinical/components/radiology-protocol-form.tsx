"use client";
import {useEffect,useRef,useState} from 'react';
import {Alert,Button} from '@pulse/ui';
import {ApiError,createStaffWebApi} from '@pulse/api-client';
import type {StaffImagingDutyDetail,StaffImagingProtocolInput,StaffImagingProtocolTemplate} from '@pulse/api-client';
const api=createStaffWebApi();
const outcomes={'clear':'Reviewed — resolved','concern':'Concern identified','unknown':'Not yet established','not-applicable':'Not applicable'};
export function RadiologyProtocolForm({order,onSaved,onState}:{order:StaffImagingDutyDetail;onSaved:(order:StaffImagingDutyDetail)=>void;onState:(dirty:boolean,busy:boolean)=>void}){
 const [templates,setTemplates]=useState<StaffImagingProtocolTemplate[]|null>(null),[selected,setSelected]=useState('');
 const [responses,setResponses]=useState<StaffImagingProtocolInput['responses']>({}),[decision,setDecision]=useState<'hold'|'approved'>('hold'),[reason,setReason]=useState('');
 const [review,setReview]=useState(false),[attestation,setAttestation]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const command=useRef({hash:'',key:''});
 const template=templates?.find(t=>t.id===selected);
 const dirty=Boolean(selected||reason||Object.keys(responses).length||attestation);
 useEffect(()=>{onState(dirty,busy);},[dirty,busy,onState]);
 useEffect(()=>{const c=new AbortController();setError(null);api.radiologyProtocols(order.id,c.signal).then(items=>{if(!c.signal.aborted)setTemplates(items);}).catch(err=>{if(!c.signal.aborted)setError(err instanceof ApiError?err.message:'Protocol templates unavailable. Retry.');});return()=>c.abort();},[order.id,revision]);
 function change(){onState(true,busy);setError(null);setAttestation(false);}
 const ready=Boolean(template&&reason.trim().length>=3&&template.checks.every(check=>{const response=responses[check.key];return response&&Object.hasOwn(outcomes,response.outcome)&&(response.outcome!=='not-applicable'||check.allowNotApplicable)&&(response.outcome==='clear'||response.note.trim().length>=3)&&(decision==='hold'||['clear','not-applicable'].includes(response.outcome));}));
 async function save(){if(!ready||!attestation||busy)return;setBusy(true);onState(true,true);setError(null);
  const body={expectedVersion:order.version,templateId:template!.id,templateVersion:template!.version,decision,responses,reason:reason.trim(),attestation:true as const};
  const hash=JSON.stringify(body);if(command.current.hash!==hash)command.current={hash,key:crypto.randomUUID()};
  try{const result=await api.reviewRadiologyProtocol(order.id,{...body,commandKey:command.current.key});onState(false,false);onSaved(result);}catch(err){setError(err instanceof ApiError?err.message:'The review could not be saved. Your entries have been retained.');}finally{setBusy(false);}
 }
 return <section className="protocol-form" aria-label="Protocol and safety review">
 <div className="protocol-form__identity"><strong>{order.patient.givenName} {order.patient.familyName}</strong><small>MRN {order.patient.mrn??'Not recorded'} · {order.procedureName}</small></div>
 {error?<Alert tone="error">{error}</Alert>:null}
 {!templates?<><p role="status">Loading facility protocols…</p>{error?<Button onClick={()=>setRevision(n=>n+1)}>Retry templates</Button>:null}</>:!templates.length?<Alert tone="info">No approved protocol template is configured for this procedure at this facility. Ask radiology governance to configure a versioned protocol and screening checklist.</Alert>:<>
 {!review?<><label>Facility protocol<select name="imagingProtocolTemplate" value={selected} disabled={busy} onChange={e=>{change();setSelected(e.target.value);setResponses({});}}><option value="">Select a protocol</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · v{t.version}</option>)}</select></label>
 {template?<><div className="protocol-policy"><strong>{template.policyReference}</strong><p>{template.instructions}</p></div><h3>Configured screening</h3><p className="protocol-form__hint">Record actual review findings. Unknown findings and concerns require a hold. Explain any exception or unresolved item.</p>
 {template.checks.map(check=><fieldset key={check.key}><legend>{check.label}</legend><label className="sr-only" htmlFor={`screen-${check.key}`}>Outcome: {check.label}</label><select id={`screen-${check.key}`} name={`screen-${check.key}`} value={responses[check.key]?.outcome??''} disabled={busy} onChange={e=>{change();setResponses(r=>({...r,[check.key]:{outcome:e.target.value as keyof typeof outcomes,note:r[check.key]?.note??''}}));}}><option value="">Select outcome</option>{Object.entries(outcomes).filter(([key])=>key!=='not-applicable'||check.allowNotApplicable).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><label>Evidence / explanation<textarea name={`evidence-${check.key}`} value={responses[check.key]?.note??''} maxLength={1000} disabled={busy} placeholder="Relevant evidence or reason; required for exceptions and unresolved items" onChange={e=>{change();setResponses(r=>({...r,[check.key]:{outcome:r[check.key]?.outcome??'unknown',note:e.target.value}}));}}/></label></fieldset>)}
 <label>Decision<select name="protocolDecision" value={decision} disabled={busy} onChange={e=>{change();setDecision(e.target.value as 'hold'|'approved');}}><option value="hold">Hold — further review required</option><option value="approved">Approve protocol for planning</option></select></label><label>Decision rationale / handover<textarea name="protocolReason" value={reason} maxLength={2000} disabled={busy} onChange={e=>{change();setReason(e.target.value);}}/></label><Button disabled={!ready||busy} onClick={()=>{setReview(true);setAttestation(false);}}>Review decision</Button></>:null}</>:<>
 <h3>Review protocol decision</h3><dl className="record-field-list"><div><dt>Protocol / version</dt><dd>{template?.name} · v{template?.version}</dd></div><div><dt>Policy</dt><dd>{template?.policyReference}</dd></div><div><dt>Decision</dt><dd>{decision==='hold'?'Hold — further review required':'Approved for planning'}</dd></div>{template?.checks.map(check=><div key={check.key}><dt>{check.label}</dt><dd>{responses[check.key]?outcomes[responses[check.key].outcome]:'Not answered'}{responses[check.key]?.note?<p>{responses[check.key].note}</p>:null}</dd></div>)}<div><dt>Rationale / handover</dt><dd>{reason}</dd></div></dl>
 <label className="lab-order-attestation"><input name="protocolAttestation" type="checkbox" checked={attestation} disabled={busy} onChange={e=>{onState(true,busy);setAttestation(e.target.checked);}}/><span>I verified the patient and requested procedure/side, reviewed the configured screening evidence and recorded this decision under the referenced facility policy.</span></label><div className="protocol-form__actions"><Button variant="secondary" disabled={busy} onClick={()=>{setReview(false);setAttestation(false);}}>Back</Button><Button disabled={!attestation||!ready||busy} onClick={()=>void save()}>{busy?'Saving…':'Confirm decision'}</Button></div>
 </>}
 <p className="protocol-form__hint">This records a planning decision. It does not book a slot, complete procedure-day checks, or authorize contrast administration or exposure.</p>
 </>}
 </section>;
}
