"use client";
import {useEffect,useState} from 'react';
import {createStaffWebApi} from '@pulse/api-client';
const api=createStaffWebApi();
export function RadiologyPacsStatus(){
 const [data,setData]=useState<Awaited<ReturnType<typeof api.radiologyPacsStatus>>|null>(null),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{const c=new AbortController();setLoading(true);api.radiologyPacsStatus(c.signal).then(result=>{if(!c.signal.aborted){setData(result);setFailed(false);}}).catch(()=>{if(!c.signal.aborted)setFailed(true);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[revision]);
 const connected=!failed&&data?.available&&data.dicomWebAvailable;
 return <div className={connected?'radiology-pacs radiology-pacs--connected':'radiology-pacs'}><span className="radiology-pacs__dot"/><span><strong>Orthanc PACS</strong><small>{loading?'Checking connection…':failed?'Connection check unavailable':connected?'Connected · DICOMweb available':data?.reason==='not-configured'?'Not configured':data?.reason==='authentication-failed'?'Connection authentication failed':'Connection unavailable'}</small></span><button type="button" aria-label="Refresh PACS connection" disabled={loading} onClick={()=>setRevision(n=>n+1)}>↻</button></div>;
}
