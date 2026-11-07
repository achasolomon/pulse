/** Display language only: backend states and authorisation remain unchanged. */
export const labStageLabels={ordered:'Collect sample',collected:'Receive sample',accessioned:'Record results',resulted:'Review & release',verified:'Results released',cancelled:'Cancelled'};
export const labSteps=['Collect sample','Receive sample','Record results','Review & release','Doctor can view'];
export function labProgress(status){return ({ordered:0,collected:1,accessioned:2,resulted:3,verified:4})[status]??-1;}
export function labNextStep(order,privileges=[],personId){
 const has=p=>privileges.includes(p),status=order.status;
 if(status==='verified')return {title:'Results are available to the doctor',detail:'The final report is in the patient’s Tests & results tab. This does not confirm the doctor has read it.',owner:'Doctor',action:'done'};
 if(status==='cancelled')return {title:'This request was cancelled',detail:'No further testing step is available for this request.',owner:'No action',action:'none'};
 if(order.patient.status!=='active')return {title:'Patient details need checking',detail:'Resolve the patient record before continuing this request.',owner:'Records team',action:'none'};
 if(status==='ordered'&&order.encounterStatus&&!['open','admitted'].includes(order.encounterStatus))return {title:'The visit is closed',detail:'Ask the clinical team to review the request before collecting a sample.',owner:'Clinical team',action:'none'};
 if(status==='collected'&&order.specimens&&order.specimens.length!==1)return {title:'The sample record needs checking',detail:'Ask the laboratory team to reconcile the sample record before receipt.',owner:'Laboratory team',action:'none'};
 if(status==='ordered')return {title:'Collect and label the sample',detail:has('lab:collect')?'Check the patient and sample label, then record collection below.':'A staff member with sample-collection access must record this step.',owner:'Sample collector',action:has('lab:collect')?'collect':'wait'};
 if(status==='collected')return {title:'Receive the sample in the laboratory',detail:has('lab:accession')?'Check the sample is suitable and record its lab sample number below.':'The receiving laboratory team needs to check and accept the sample.',owner:'Laboratory receiving team',action:has('lab:accession')?'receive':'wait'};
 if(status==='accessioned')return {title:'Run the test and record the results',detail:has('lab:result')?'Choose Enter results to record the findings from this sample.':'A staff member with result-entry access must record the findings.',owner:'Laboratory technician',action:has('lab:result')?'enter':'wait'};
 if(status==='resulted'){
  const own=Boolean(personId&&(order.results??[]).some(r=>r.recordedBy===personId));
  if(own)return {title:'Ready for another verifier to review',detail:'You entered part of this report. A different authorised verifier must check and release it. Add any remaining results before handover.',owner:'Another laboratory verifier',action:'wait-verifier'};
  return {title:has('lab:verify')?'Check the report before release':'Waiting for a laboratory verifier',detail:has('lab:verify')?'Check all requested results, sample details, values and units. Resolve any critical-result handoff before release.':'The report appears in Review & release. A verifier must check it before the doctor can view the final results.',owner:'Laboratory verifier',action:has('lab:verify')?'verify':'wait-verifier'};
 }
 return {title:'Review this request',detail:'Check its current status before continuing.',owner:'Laboratory team',action:'none'};
}
export function workflowStatusLabel(value){return ({ordered:'Requested',collected:'Sample collected',accessioned:'Sample received',resulted:'Results awaiting review',verified:'Results released',protocolled:'Ready for imaging',acquired:'Images acquired',reported:'Report awaiting sign-off',final:'Final report'})[value]??value.replaceAll('-',' ').replaceAll('_',' ');}
