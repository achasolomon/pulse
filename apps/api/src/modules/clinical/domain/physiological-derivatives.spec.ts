import { expect, it } from 'vitest';
import { physiologicalDerivatives } from './physiological-derivatives.js';
const now = new Date('2026-10-15T12:00:00Z');
const patient = {dateOfBirth:'1990-01-01',sex:'M' as const};
const observation = (code:string,value:string,unit:string) => ({id:code,code,value,unit,encounterId:'visit',takenAt:'2026-10-15T10:00:00Z',origin:'local'});
const body = [observation('weight','80','kg'),observation('height','200','cm')];
const bp = [observation('bp-systolic','120','mmHg'),observation('bp-diastolic','80','mmHg')];
it('calculates BMI, Mosteller area and attributed lean estimate from matching inputs',()=>{
  const values=physiologicalDerivatives(body,patient,now);
  expect(values.find(v=>v.code==='bmi')).toMatchObject({value:20,category:'Healthy-weight band',sourceIds:['weight','height']});
  expect(values.find(v=>v.code==='bsa')?.value).toBe(2.11);
  expect(values.find(v=>v.code==='lean-mass')?.value).toBe(67.4);
});
it('calculates pulse pressure and estimated MAP without assigning an invented normal band',()=>{
  const values=physiologicalDerivatives(bp,patient,now);
  expect(values.find(v=>v.code==='pulse-pressure')).toMatchObject({value:40,category:'Calculated'});
  expect(values.find(v=>v.code==='map')).toMatchObject({value:93.3,category:'Estimate'});
});
it('normalizes supported units and classifies adult obesity screening bands',()=>{
  expect(physiologicalDerivatives([body[0],observation('height','2','m')],patient,now)[0].value).toBe(20);
  expect(physiologicalDerivatives([observation('weight','120','kg'),body[1]],patient,now)[0]).toMatchObject({value:30,category:'Obesity class 1',status:'attention'});
  expect(physiologicalDerivatives([observation('weight','160','kg'),body[1]],patient,now)[0].category).toBe('Obesity class 3');
});
it('refuses mixed encounters, times, sources, invalid units and missing inputs',()=>{
  for(const change of [{encounterId:'other'},{encounterId:null},{takenAt:'2026-10-14T10:00:00Z'},{origin:'other'},{unit:'unknown'},{value:'0'},{value:'abc'}]){
    expect(physiologicalDerivatives([body[0],{...body[1],...change}],patient,now)[0].value).toBeNull();
  }
  expect(physiologicalDerivatives([],patient,now).every(v=>v.value===null)).toBe(true);
  expect(physiologicalDerivatives([observation('bp-systolic','70','mmHg'),bp[1]],patient,now).find(v=>v.code==='map')?.value).toBeNull();
});
it('does not infer sex, apply adult profiles to children, or calculate when disabled',()=>{
  expect(physiologicalDerivatives(body,{...patient,sex:'U'},now).find(v=>v.code==='lean-mass')?.value).toBeNull();
  expect(physiologicalDerivatives(body,{...patient,dateOfBirth:'2010-01-01'},now)[0].value).toBeNull();
  expect(physiologicalDerivatives(body,patient,now,false)[0].value).toBeNull();
});
