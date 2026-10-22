import test from 'node:test';
import assert from 'node:assert/strict';
import {validNoteDocument,noteDocumentText,plainNoteDocument,appendNoteDocument} from '../../../packages/api-contracts/src/note-rich-text.mjs';
test('rich note codec preserves plain narrative and appends without losing marks',()=>{
  const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Patient history',marks:[{type:'bold'}]}]}]};
  assert.ok(validNoteDocument(doc));assert.equal(noteDocumentText(doc),'Patient history');
  const appended=appendNoteDocument(doc,'Patient history','Follow-up\nMore detail');
  assert.deepEqual(appended.content[0],doc.content[0]);
  assert.equal(noteDocumentText(appended),'Patient history\n\nFollow-up\nMore detail');
  assert.equal(noteDocumentText(appendNoteDocument(undefined,'','First entry')),'First entry');
  for(const value of ['','One\nTwo','One\n\nTwo'])assert.equal(noteDocumentText(plainNoteDocument(value)),value);
});
test('rich note schema rejects scripts, links, arbitrary attributes, unsafe list types and excess nesting',()=>{
  const wrap=node=>({type:'doc',content:[node]});
  for(const node of [{type:'script',text:'bad'},{type:'image',attrs:{src:'x'}},{type:'paragraph',attrs:{onclick:'bad'}},{type:'text',text:'link',marks:[{type:'link',attrs:{href:'javascript:bad'}}]},{type:'orderedList',attrs:{start:1,type:'unsafe'},content:[]}])assert.equal(validNoteDocument(wrap(node)),false);
  let deep={type:'text',text:'nested'};for(let i=0;i<20;i++)deep={type:'blockquote',content:[deep]};assert.equal(validNoteDocument(wrap(deep)),false);
});
