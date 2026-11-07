import type {StaffPacsStatus} from '@pulse/api-contracts';
import type {PacsGateway,PacsStudyBinding,PacsStudyVerification} from '../domain/pacs.gateway.js';
interface OrthancConfig {baseUrl?:string;username?:string;password?:string;production?:boolean;}
/** Server-owned endpoint only. No browser URL forwarding, redirects or raw upstream errors. */
export class OrthancGateway implements PacsGateway {
 constructor(private readonly config:OrthancConfig,private readonly request:typeof fetch=fetch){}
 private async json(response:Response,limit=32768){
  if(!response.ok)throw new Error(response.status===401||response.status===403?'authentication-failed':'unavailable');
  if(!response.headers.get('content-type')?.includes('json'))throw new Error('invalid-response');
  const reader=response.body?.getReader();if(!reader)throw new Error('invalid-response');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('invalid-response');}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(buffer)) as unknown;}catch{throw new Error('invalid-response');}
 }
 async verifyStudy(binding:PacsStudyBinding):Promise<PacsStudyVerification>{
  const checkedAt=new Date().toISOString();
  const fail=(reason:Extract<PacsStudyVerification,{verified:false}>['reason']):PacsStudyVerification=>({verified:false,reason,checkedAt});
  const uid=(value:unknown):value is string=>typeof value==='string'&&value.length<=64&&/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$/.test(value);
  if(!uid(binding.studyUid)||![binding.patientId,binding.issuer,binding.accession,binding.modality].every(value=>typeof value==='string'&&value.length>0&&value.length<=64)||binding.accession.length>16||!/^[A-Z0-9]{1,16}$/.test(binding.modality)||(binding.birthDate!==null&&!/^\d{8}$/.test(binding.birthDate)))return fail('invalid-configuration');
  const {baseUrl,username,password,production}=this.config;if(!baseUrl||!username||!password)return fail('not-configured');
  let base:URL;try{base=new URL(baseUrl);if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol)||(base.protocol==='http:'&&(production||!['localhost','127.0.0.1','[::1]','orthanc'].includes(base.hostname))))throw new Error();}catch{return fail('invalid-configuration');}
  const headers={Authorization:`Basic ${Buffer.from(username+':'+password).toString('base64')}`,Accept:'application/dicom+json'};
  // One absolute deadline also bounds response streaming, rather than only the initial headers.
  const signal=AbortSignal.timeout(10000);
  const get=async(path:string,query?:Record<string,string>)=>{const url=new URL(base.pathname.replace(/\/$/,'')+path,base);for(const [key,value] of Object.entries(query??{}))url.searchParams.set(key,value);return this.json(await this.request(url,{headers,redirect:'error',signal}),8*1024*1024);};
  const tag=(item:unknown,key:string):unknown=>{if(!item||typeof item!=='object')return undefined;const element=(item as Record<string,unknown>)[key];if(!element||typeof element!=='object')return undefined;const values=(element as {Value?:unknown}).Value;return Array.isArray(values)&&values.length===1?values[0]:undefined;};
  try{
   const studies=await get('/dicom-web/studies',{StudyInstanceUID:binding.studyUid,limit:'2'});
   if(!Array.isArray(studies))return fail('invalid-response');if(studies.length===0)return fail('not-found');if(studies.length!==1||tag(studies[0],'0020000D')!==binding.studyUid)return fail('identity-mismatch');
   const metadata=await get('/dicom-web/studies/'+encodeURIComponent(binding.studyUid)+'/metadata');
   if(!Array.isArray(metadata)||metadata.length===0||metadata.length>1000)return fail('invalid-response');
   const series=new Set<string>(),instances=new Set<string>();
   for(const instance of metadata){
    if(tag(instance,'0020000D')!==binding.studyUid||tag(instance,'00100020')!==binding.patientId||tag(instance,'00100021')!==binding.issuer||tag(instance,'00080050')!==binding.accession||tag(instance,'00080060')!==binding.modality||(binding.birthDate!==null&&tag(instance,'00100030')!==binding.birthDate))return fail('identity-mismatch');
    const seriesUid=tag(instance,'0020000E'),instanceUid=tag(instance,'00080018');if(!uid(seriesUid)||!uid(instanceUid)||instances.has(instanceUid))return fail('invalid-response');series.add(seriesUid);instances.add(instanceUid);
   }
   return {verified:true,studyUid:binding.studyUid,seriesCount:series.size,instanceCount:instances.size,checkedAt};
  }catch(err){const message=err instanceof Error?err.message:'';return fail(message==='authentication-failed'||message==='invalid-response'?message:'unavailable');}
 }
 async status():Promise<StaffPacsStatus>{
  const result:StaffPacsStatus={provider:'Orthanc',configured:false,available:false,dicomWebAvailable:false,version:null,reason:'not-configured',checkedAt:new Date().toISOString()};
  const {baseUrl,username,password,production}=this.config;if(!baseUrl||!username||!password)return result;
  let base:URL;try{base=new URL(baseUrl);if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol)||(base.protocol==='http:'&&(production||!['localhost','127.0.0.1','[::1]','orthanc'].includes(base.hostname))))throw new Error();}catch{return {...result,reason:'invalid-configuration'};}
  result.configured=true;
  const headers={Authorization:`Basic ${Buffer.from(username+':'+password).toString('base64')}`,Accept:'application/json'};
  try{
   const system=await this.json(await this.request(new URL(base.pathname.replace(/\/$/,'')+'/system',base),{headers,redirect:'error',signal:AbortSignal.timeout(5000)}));
   if(!system||typeof system!=='object'||!('Version' in system)||typeof system.Version!=='string'||!/^[0-9A-Za-z.+_-]{1,40}$/.test(system.Version))throw new Error('invalid-response');
   result.available=true;result.version=system.Version;
   const qido=new URL(base.pathname.replace(/\/$/,'')+'/dicom-web/studies',base);qido.searchParams.set('limit','1');qido.searchParams.set('StudyInstanceUID','2.25.0');
   const studies=await this.json(await this.request(qido,{headers:{...headers,Accept:"application/dicom+json"},redirect:'error',signal:AbortSignal.timeout(5000)}));if(!Array.isArray(studies))throw new Error('invalid-response');
   result.dicomWebAvailable=true;result.reason=null;return result;
  }catch(err){const message=err instanceof Error?err.message:'';result.reason=['authentication-failed','invalid-response'].includes(message)?message as 'authentication-failed'|'invalid-response':'unavailable';return result;}
 }
}
