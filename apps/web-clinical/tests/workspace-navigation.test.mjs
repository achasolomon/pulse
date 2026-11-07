import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workspaceNavigation,worklistTabs,canUseCriticalResults} from '../lib/workspace-navigation.mjs';
const ids = p => workspaceNavigation(p).map(item=>item.id);
test('radiology duty is separate from patient imaging reads and requires patient identity permission',()=>{
 assert.ok(!ids(['patient:read','imaging:view','imaging:order']).includes('radiology'));
 assert.ok(!ids(['imaging:view','imaging:worklist']).includes('radiology'));
 assert.ok(ids(['patient:read','imaging:view','imaging:worklist']).includes('radiology'));
});
test('no privileges exposes only shared workspace and notifications',()=>assert.deepEqual(ids([]),['workspace','notifications']));
test('reception and records do not inherit clinical actions',()=>{
 assert.deepEqual(ids(['patient:read','encounter:read','appointment:read']),['workspace','patients','reception','notifications']);
 assert.deepEqual(ids(['patient:read','patient:register']),['workspace','patients','notifications']);
});
test('nursing and consultation queues require both capabilities',()=>{
 assert.deepEqual(worklistTabs(['observation:write','encounter:consult']),[]);
 assert.deepEqual(worklistTabs(['encounter:read','observation:write']).map(t=>t.id),['vitals']);
 assert.deepEqual(worklistTabs(['encounter:read','encounter:consult']).map(t=>t.id),['consultation']);
});
test('lab duty access is distinct from reading patient investigations',()=>{
 assert.ok(!ids(['lab:read','imaging:view']).includes('laboratory'));
 assert.ok(ids(['lab:read','lab:worklist']).includes('laboratory'));
 assert.ok(!ids(['lab:worklist']).includes('laboratory'));
});
test('critical follow-up requires acknowledgement or laboratory duty/result capabilities',()=>{
 assert.equal(canUseCriticalResults(['lab:critical:ack']),false);
 assert.equal(canUseCriticalResults(['lab:read','lab:critical:ack']),true);
 assert.equal(canUseCriticalResults(['lab:read','lab:worklist','lab:result']),true);
 assert.equal(canUseCriticalResults(['lab:read','lab:verify']),false);
});
test('combined memberships expose each granted workflow once and explicit queue links',()=>{
 const p=['patient:read','encounter:read','appointment:read','observation:write','encounter:consult','lab:read','lab:worklist','lab:verify'];
 const nav=workspaceNavigation(p);assert.equal(new Set(nav.map(i=>i.id)).size,nav.length);
 assert.deepEqual(nav.filter(i=>i.href.startsWith('/worklists')).map(i=>i.href),['/worklists?queue=reception','/worklists?queue=vitals','/worklists?queue=consultation','/worklists?queue=laboratory']);
});
test('imaging communication and acknowledgement expose critical follow-up with identity access',()=>{
 assert.equal(canUseCriticalResults(['patient:read','imaging:view','imaging:acknowledge']),true);
 assert.equal(canUseCriticalResults(['patient:read','imaging:view','imaging:worklist','imaging:communicate']),true);
 assert.equal(canUseCriticalResults(['imaging:view','imaging:acknowledge']),false);
 assert.equal(canUseCriticalResults(['patient:read','imaging:view','imaging:report']),false);
});
