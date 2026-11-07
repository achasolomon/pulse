"use client";
import {useEffect,useState} from 'react';
import {Alert,Button} from '@pulse/ui';
import {ApiError,createStaffWebApi} from '@pulse/api-client';
const api=createStaffWebApi();
export function RadiologyReadiness({orderId,version}:{orderId:string;version:number}){
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(0),[data,setData]=useState<Awaited<ReturnType<typeof api.radiologyReadiness>>|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{if(!open)return;const c=new AbortController();setData(null);setError(null);api.radiologyReadiness(orderId,c.signal).then(result=>{if(!c.signal.aborted)setData(result);}).catch(err=>{if(!c.signal.aborted)setError(err instanceof ApiError?err.message:'Prerequisites could not refresh. Retry.');});return()=>c.abort();},[orderId,version,open,revision]);
 return <section className="radiology-prerequisites"><button className="radiology-open" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Acquisition prerequisites {open?'−':'+'}</button>{open?<>{error?<Alert tone="error">{error}</Alert>:!data?<p role="status">Checking current request and appointment…</p>:<><p className="protocol-form__hint">Recorded prerequisites, checked {new Date(data.checkedAt).toLocaleTimeString()}.</p><ul>{data.checks.map(check=><li key={check.id}><span className={check.met?'radiology-check radiology-check--met':'radiology-check'}>{check.met?'Recorded':'Review'}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div></li>)}</ul><Alert tone="info">{data.prerequisitesSatisfied?'These recorded prerequisites are satisfied. ':''}Procedure-day safety verification and acquisition authorisation remain separate.</Alert></>}<Button variant="secondary" onClick={()=>setRevision(n=>n+1)}>Refresh prerequisites</Button></>:null}</section>;
}
