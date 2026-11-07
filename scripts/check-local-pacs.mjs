// Synthetic local PACS exercise; never use real patient data or a production endpoint.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {OrthancGateway} from '../apps/api/dist/modules/imaging/infrastructure/orthanc.gateway.js';
import {syntheticDicomPixels} from './lib/synthetic-dicom-pixels.mjs';
assert.equal(process.env.PULSE_PACS_SYNTHETIC_TEST,'yes','Explicit synthetic PACS test opt-in required');
assert.notEqual(process.env.NODE_ENV,'production');
const credentials=JSON.parse(await readFile(new URL('../tmp/pacs/credentials.json',import.meta.url),'utf8'));
const base='http://127.0.0.1:8043',headers={Authorization:'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64')};
async function call(path,options={}){return fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(10000),redirect:'error'});}
const system=await call('/system');assert.equal(system.status,200);const server=await system.json();assert.equal(server.Name,'Pulse Local Development PACS');
assert.equal((await fetch(base+'/system',{signal:AbortSignal.timeout(5000)})).status,401);
const connection=await new OrthancGateway({baseUrl:base,...credentials}).status();assert.equal(connection.available,true);assert.equal(connection.dicomWebAvailable,true);
const patientId='PULSE-SYN-'+randomUUID(),uid='2.25.'+BigInt('0x'+randomUUID().replaceAll('-','')).toString();let studyId;
const binding={studyUid:uid,patientId,issuer:'PULSE:'+randomUUID(),accession:'P'+randomUUID().replaceAll('-','').slice(0,15),modality:'DX',birthDate:'19900115'};
try{
 const gateway=new OrthancGateway({baseUrl:base,...credentials});assert.equal((await gateway.verifyStudy(binding)).reason,'not-found');
 const seriesUid='2.25.'+BigInt('0x'+randomUUID().replaceAll('-','')).toString();let instance;
 for(let index=0;index<3;index++){
  const created=await call('/tools/create-dicom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({Force:true,Tags:{PatientID:patientId,IssuerOfPatientID:binding.issuer,AccessionNumber:binding.accession,PatientName:'SYNTHETIC^PULSE^PACS',PatientBirthDate:binding.birthDate,StudyDescription:'SYNTHETIC QA PHANTOM - NOT FOR CLINICAL USE',SeriesDescription:'Synthetic pixel roundtrip',Modality:binding.modality,SOPClassUID:'1.2.840.10008.5.1.4.1.1.7',StudyInstanceUID:uid,SeriesInstanceUID:seriesUid,InstanceNumber:String(index+1)},Content:syntheticDicomPixels(index)})});assert.equal(created.status,200);instance=await created.json();assert.match(instance.ParentStudy,/^[a-f0-9]{8}(?:-[a-f0-9]{8}){4}$/);if(studyId)assert.equal(instance.ParentStudy,studyId);studyId=instance.ParentStudy;
 }
 const studies=await call('/dicom-web/studies?'+new URLSearchParams({StudyInstanceUID:uid,limit:'1'}),{headers:{Accept:'application/dicom+json'}});assert.equal(studies.status,200);const listed=await studies.json();assert.equal(listed.length,1);assert.equal(listed[0]['0020000D'].Value[0],uid);assert.equal(listed[0]['00100020'].Value[0],patientId);
 const metadata=await call('/dicom-web/studies/'+uid+'/metadata',{headers:{Accept:'application/dicom+json'}});assert.equal(metadata.status,200);assert.equal((await metadata.json())[0]['0020000D'].Value[0],uid);
 const file=await call('/instances/'+instance.ID+'/file');assert.equal(file.status,200);const dicom=Buffer.from(await file.arrayBuffer());assert.ok(dicom.length<1024*1024);
 const boundary='pulse-synthetic-'+randomUUID();const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/dicom\r\n\r\n'),dicom,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 const stow=await call('/dicom-web/studies',{method:'POST',headers:{'Content-Type':'multipart/related; type="application/dicom"; boundary='+boundary,Accept:'application/dicom+json'},body});assert.ok([200,202].includes(stow.status));
 assert.deepEqual({...await gateway.verifyStudy(binding),checkedAt:null},{verified:true,studyUid:uid,seriesCount:1,instanceCount:3,checkedAt:null});
 const preview=await call('/instances/'+instance.ID+'/preview');assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/image\/png/);const previewBytes=Buffer.from(await preview.arrayBuffer());assert.equal(previewBytes.readUInt32BE(16),128);assert.equal(previewBytes.readUInt32BE(20),128);
 for(const field of ['patientId','issuer','accession','modality','birthDate']){const wrong={...binding,[field]:field==='birthDate'?'20000101':field==='modality'?'CT':'WRONG'};assert.equal((await gateway.verifyStudy(wrong)).reason,'identity-mismatch');}
 console.log('Orthanc local check passed: authenticated server, unauthenticated denial, synthetic QIDO/WADO/STOW, server-side study identity verification and rejection of five identity mismatches. No Pulse clinical records created.');
}finally{
 if(studyId){const study=await call('/studies/'+studyId);assert.equal(study.status,200);const details=await study.json();assert.equal(details.MainDicomTags.StudyInstanceUID,uid);assert.equal((await call('/studies/'+studyId,{method:'DELETE'})).status,200);}
}
const after=await call('/dicom-web/studies?'+new URLSearchParams({StudyInstanceUID:uid}),{headers:{Accept:'application/dicom+json'}});assert.deepEqual(await after.json(),[]);console.log('Synthetic PACS study removed.');
