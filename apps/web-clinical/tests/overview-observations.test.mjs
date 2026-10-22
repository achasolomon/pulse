import assert from 'node:assert/strict';
import test from 'node:test';
import { overviewObservations } from '../lib/overview-observations.ts';
const systolic = {id:'s',code:'bp-systolic',value:'120',unit:'mmHg',takenAt:'2026-10-15T10:00:00Z',origin:'local',encounterId:'visit-a'};
const diastolic = {...systolic,id:'d',code:'bp-diastolic',value:'80'};
test('paired blood pressure retains recorded units and provenance',()=>{
  const result=overviewObservations([systolic,diastolic]);
  assert.equal(result.length,1);assert.equal(result[0].value,'120/80');
  assert.equal(result[0].code,'blood-pressure');assert.equal(result[0].unit,'mmHg');
});
test('different visits, times, sources and units never produce a synthetic BP pair',()=>{
  for(const change of [{encounterId:'visit-b'},{takenAt:'2026-10-14T10:00:00Z'},{origin:'device'},{unit:'kPa'},{value:null}]){
    assert.equal(overviewObservations([systolic,{...diastolic,...change}]).length,2);
  }
  assert.equal(overviewObservations([{...systolic,encounterId:null},{...diastolic,encounterId:null}]).length,2);
});
test('paired BP retains the more severe component assessment, including isolated diastolic elevation',()=>{
  const low={status:'not-flagged',label:'No high flag',reason:'not a normal certification',ruleId:'bp',ruleVersion:'v1',sourceUrl:null};
  const high={...low,status:'urgent',label:'Severely high'};
  assert.equal(overviewObservations([{...systolic,assessment:low},{...diastolic,assessment:high}])[0].assessment.status,'urgent');
  assert.equal(overviewObservations([{...systolic,assessment:high},{...diastolic,assessment:low}])[0].assessment.status,'urgent');
  assert.equal(overviewObservations([{...systolic,assessment:low},diastolic])[0].assessment,undefined);
});
