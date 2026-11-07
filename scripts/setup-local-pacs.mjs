// Explicit, local-only developer setup. No clinical studies or database writes.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
assert.notEqual(process.env.NODE_ENV,'production');
const root=new URL('../tmp/pacs/',import.meta.url);await mkdir(root,{recursive:true});
let credentials;try{credentials=JSON.parse(await readFile(new URL('credentials.json',root),'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;credentials={username:'pulse-local',password:randomBytes(24).toString('base64url')};}
assert.equal(credentials.username,'pulse-local');assert.ok(typeof credentials.password==='string'&&credentials.password.length>=24);
const config={Name:'Pulse Local Development PACS',DicomAet:'PULSE_DEV',RemoteAccessAllowed:true,AuthenticationEnabled:true,RegisteredUsers:{[credentials.username]:credentials.password},DicomServerEnabled:true,DicomCheckCalledAet:true,DicomAlwaysAllowEcho:true,DicomAlwaysAllowStore:false,DicomAlwaysAllowFind:false,DicomAlwaysAllowMove:false,DicomModalities:{},DicomWeb:{Enable:true,Root:'/dicom-web/'},HttpDescribeErrors:false};
await writeFile(new URL('credentials.json',root),JSON.stringify(credentials,null,2)+'\n',{mode:0o600});
await writeFile(new URL('orthanc.json',root),JSON.stringify(config,null,2)+'\n',{mode:0o600});
await writeFile(new URL('.env.api',root),`PULSE_ORTHANC_BASE_URL=http://127.0.0.1:8043\nPULSE_ORTHANC_USERNAME=${credentials.username}\nPULSE_ORTHANC_PASSWORD=${credentials.password}\n`,{mode:0o600});
console.log('Local Orthanc configuration and credentials prepared under ignored tmp/pacs/. No clinical data created.');
