import {describe,it,expect,vi} from 'vitest';
import {OrthancGateway} from './orthanc.gateway.js';
const config={baseUrl:'http://127.0.0.1:8043',username:'test-user',password:'test-secret'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
describe('server-side Orthanc connection',()=>{
 it('does not call an unconfigured endpoint',async()=>{const request=vi.fn();expect((await new OrthancGateway({},request).status()).reason).toBe('not-configured');expect(request).not.toHaveBeenCalled();});
 it('rejects credentials in URLs and plaintext production endpoints',async()=>{const request=vi.fn();for(const baseUrl of ['http://user:secret@127.0.0.1:8043','http://pacs.example.test','file:///tmp/pacs'])expect((await new OrthancGateway({...config,baseUrl},request).status()).reason).toBe('invalid-configuration');expect((await new OrthancGateway({...config,production:true},request).status()).reason).toBe('invalid-configuration');expect(request).not.toHaveBeenCalled();});
 it('checks authenticated core and bounded DICOMweb search without returning credentials or metadata',async()=>{
  const request=vi.fn().mockResolvedValueOnce(json({Version:'1.12.12',Name:'private configuration'})).mockResolvedValueOnce(json([]));
  const result=await new OrthancGateway(config,request).status();expect(result).toMatchObject({configured:true,available:true,dicomWebAvailable:true,version:'1.12.12',reason:null});expect(request).toHaveBeenCalledTimes(2);
  const [url,options]=request.mock.calls[1]!;expect(String(url)).toContain('StudyInstanceUID=2.25.0');expect(String(url)).toContain('limit=1');expect(options.redirect).toBe('error');expect(options.signal).toBeInstanceOf(AbortSignal);expect(options.headers.Authorization).toBe('Basic '+Buffer.from('test-user:test-secret').toString('base64'));expect(JSON.stringify(result)).not.toMatch(/test-secret|private configuration|Authorization/);
 });
 it('sanitizes authentication failures',async()=>{const result=await new OrthancGateway(config,vi.fn().mockResolvedValue(new Response('secret upstream error',{status:401}))).status();expect(result.reason).toBe('authentication-failed');expect(result.available).toBe(false);expect(JSON.stringify(result)).not.toContain('secret upstream');});
 it('distinguishes core connectivity from missing DICOMweb',async()=>{const request=vi.fn().mockResolvedValueOnce(json({Version:'1.12.12'})).mockResolvedValueOnce(new Response('not found',{status:404}));expect(await new OrthancGateway(config,request).status()).toMatchObject({available:true,dicomWebAvailable:false,reason:'unavailable'});});
 it('rejects malformed or excessive upstream payloads',async()=>{for(const response of [json({Version:'bad version / token'}),json({Version:'1.12.12',padding:'x'.repeat(40000)}),new Response('<html>not json</html>',{headers:{'Content-Type':'text/html'}})])expect((await new OrthancGateway(config,vi.fn().mockResolvedValue(response)).status()).reason).toBe('invalid-response');});
 it('returns a safe unavailable state for transport failures and redirects',async()=>{const result=await new OrthancGateway(config,vi.fn().mockRejectedValue(new Error('http://test-user:test-secret@private/failed'))).status();expect(result.reason).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('test-secret');});
});
const binding={studyUid:'2.25.123',patientId:'SYNTHETIC-123',issuer:'PULSE:facility-123',accession:'P123456789',modality:'DX',birthDate:'19900115'};
const instance=(overrides:Record<string,unknown>={})=>Object.fromEntries(Object.entries({'0020000D':binding.studyUid,'00100020':binding.patientId,'00100021':binding.issuer,'00080050':binding.accession,'00080060':binding.modality,'00100030':binding.birthDate,'0020000E':'2.25.234','00080018':'2.25.345',...overrides}).map(([key,value])=>[key,{Value:[value]}]));
describe('Orthanc acquisition identity verification',()=>{
 it('verifies every instance and returns only bounded evidence',async()=>{
  const request=vi.fn().mockResolvedValueOnce(json([instance()])).mockResolvedValueOnce(json([instance(),instance({'00080018':'2.25.346'})]));
  expect(await new OrthancGateway(config,request).verifyStudy(binding)).toMatchObject({verified:true,studyUid:binding.studyUid,seriesCount:1,instanceCount:2});
  expect(String(request.mock.calls[0]![0])).toContain('StudyInstanceUID=2.25.123');expect(String(request.mock.calls[0]![0])).toContain('limit=2');expect(String(request.mock.calls[1]![0])).toContain('/studies/2.25.123/metadata');
 });
 it('rejects each mismatching identity field, including a mixed-patient later instance',async()=>{
  for(const field of ['0020000D','00100020','00100021','00080050','00080060','00100030']){
   const request=vi.fn().mockResolvedValueOnce(json([instance()])).mockResolvedValueOnce(json([instance(),instance({[field]:'WRONG','00080018':'2.25.346'})]));
   const result=await new OrthancGateway(config,request).verifyStudy(binding);expect(result).toMatchObject({verified:false,reason:'identity-mismatch'});expect(JSON.stringify(result)).not.toContain('WRONG');
  }
 });
 it('does not accept missing issuer or repeated instances',async()=>{
  for(const records of [[instance({'00100021':undefined})],[instance(),instance()]]){
   const request=vi.fn().mockResolvedValueOnce(json([instance()])).mockResolvedValueOnce(json(records));expect((await new OrthancGateway(config,request).verifyStudy(binding)).verified).toBe(false);
  }
 });
 it('distinguishes not yet received from ambiguous studies and malformed metadata',async()=>{
  for(const [studies,metadata,reason] of [[[],[], 'not-found'],[[instance(),instance()],[], 'identity-mismatch'],[[instance()],[], 'invalid-response'],[[instance()],Array(1001).fill(instance()),'invalid-response']] as const){
   const request=vi.fn().mockResolvedValueOnce(json(studies)).mockResolvedValueOnce(json(metadata));expect(await new OrthancGateway(config,request).verifyStudy(binding)).toMatchObject({verified:false,reason});
  }
 });
 it('rejects lookup injection before any network request',async()=>{const request=vi.fn();for(const studyUid of ['../../patients','2.25.1?PatientID=*','2.25.01','2.25.'+'1'.repeat(64)])expect(await new OrthancGateway(config,request).verifyStudy({...binding,studyUid})).toMatchObject({verified:false,reason:'invalid-configuration'});expect(request).not.toHaveBeenCalled();});
 it('sanitizes verification network errors and enforces metadata size',async()=>{
  const request=vi.fn().mockRejectedValue(new Error('secret upstream token'));expect(await new OrthancGateway(config,request).verifyStudy(binding)).toMatchObject({verified:false,reason:'unavailable'});
  const large=vi.fn().mockResolvedValueOnce(json([instance()])).mockResolvedValueOnce(json({padding:'x'.repeat(8*1024*1024)}));expect(await new OrthancGateway(config,large).verifyStudy(binding)).toMatchObject({verified:false,reason:'invalid-response'});
 });
});
