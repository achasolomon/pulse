import test from 'node:test';
import assert from 'node:assert/strict';
import {labNextStep,labProgress} from '../lib/workflow-language.mjs';
const order=(status,results=[])=>({status,results,patient:{status:'active'}});
test('lab journey advances through recorded steps without inventing a testing-start event',()=>{
 assert.deepEqual(['ordered','collected','accessioned','resulted','verified'].map(labProgress),[0,1,2,3,4]);assert.equal(labProgress('cancelled'),-1);
 assert.equal(labNextStep(order('accessioned'),['lab:result']).action,'enter');
});
test('lab next action respects permissions and independent-verifier responsibility',()=>{
 assert.equal(labNextStep(order('collected'),[]).action,'wait');assert.equal(labNextStep(order('collected'),['lab:accession']).action,'receive');
 assert.equal(labNextStep(order('resulted',[{recordedBy:'me'}]),['lab:verify'],'me').action,'wait-verifier');
 assert.equal(labNextStep(order('resulted',[{recordedBy:'other'}]),['lab:verify'],'me').action,'verify');
});
test('released results indicate chart availability rather than clinician acknowledgement',()=>{
 const step=labNextStep(order('verified'));assert.equal(step.action,'done');assert.match(step.detail,/does not confirm/);
 assert.equal(labNextStep({...order('ordered'),patient:{status:'retired-duplicate'}},['lab:collect']).action,'none');
});
