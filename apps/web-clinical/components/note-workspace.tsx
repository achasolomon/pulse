"use client";
import { useEffect, useRef, useState } from 'react';
import { createStaffWebApi, appendNoteDocument, noteDocumentText, type StaffNoteContent, type StaffNoteDraftContent } from '@pulse/api-client';
import { RecordIcon } from './record-icon.js';
import { RichNoteEditor } from './rich-note-editor.js';
const api=createStaffWebApi();
export type NoteSection='subjective'|'objective'|'assessment'|'plan';
const sections: {id:NoteSection;label:string;field:keyof StaffNoteContent}[]=[{id:'subjective',label:'Subjective',field:'history'},{id:'objective',label:'Objective',field:'examination'},{id:'assessment',label:'Assessment',field:'assessment'},{id:'plan',label:'Plan',field:'plan'}];
const templates=[
  {id:'general',name:'General consultation',kind:'consultation',history:'History of present illness:\n\nRelevant past medical history:\n\nCurrent medication history:\n\nReview of systems:',examination:'Examination findings:',assessment:'Clinical impression:\n\nDifferential considerations:',plan:'Management plan:\n\nFollow-up:\n\nPatient discussion:'},
  {id:'followup',name:'Follow-up review',kind:'consultation',history:'Reason for follow-up:\n\nInterval history:\n\nTreatment experience:\n\nPatient concerns:',examination:'Interval examination findings:',assessment:'Progress and clinical assessment:',plan:'Agreed plan:\n\nFollow-up and safety-net discussion:'},
  {id:'nursing',name:'Nursing assessment',kind:'nursing',history:'Patient concerns:\n\nNursing observations:\n\nRelevant history:',examination:'Assessment findings:\n\nRecorded observations:',assessment:'Nursing assessment:\n\nCare needs:',plan:'Care provided:\n\nResponse to care:\n\nHandover and follow-up:'},
  {id:'handover',name:'Nursing handover',kind:'nursing',history:'Reason for handover:\n\nRelevant background:',examination:'Current observations:',assessment:'Assessment and outstanding concerns:',plan:'Handover information:\n\nOutstanding care and receiving clinician:'},
];
const limits={chiefComplaint:2000,history:10000,examination:10000,assessment:10000,plan:10000};
type Preview={title:string;text:string;target:keyof StaffNoteContent};
export function NoteWorkspace({patientId,privileges,kind,values,onChange,busy,section,onSectionChange}:{patientId:string;privileges:string[];kind:'consultation'|'nursing';values:StaffNoteDraftContent;onChange:(values:StaffNoteDraftContent)=>void;busy:boolean;section:NoteSection;onSectionChange:(section:NoteSection)=>void}){
  const [search,setSearch]=useState(''),[template,setTemplate]=useState<string|null>(null),[preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const selected=templates.find(item=>item.id===template&&item.kind===kind);
  function append(parts:Partial<StaffNoteContent>){
    const next={...values};
    for(const field of Object.keys(parts) as (keyof StaffNoteContent)[]){
      if(field==='chiefComplaint')next[field]=[values[field],parts[field]].filter(Boolean).join('\n\n');
      else {const doc=appendNoteDocument(values.richText?.[field],values[field],parts[field]??'');next[field]=noteDocumentText(doc);next.richText={...next.richText,[field]:doc};}
      if(next[field].length>limits[field]){setError('This insertion would exceed a section limit. Shorten the existing text first.');return;}
    }
    if(JSON.stringify(next.richText??{}).length>60000){setError('The note exceeds its formatting limit. Shorten the existing content first.');return;}
    onChange(next);setError(null);setPreview(null);setTemplate(null);
  }
  async function context(which:'vitals'|'medications'|'entries'|'investigations'){
    request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError(null);setTemplate(null);setPreview(null);
    try{
      let text='',target:keyof StaffNoteContent=which==='vitals'?'examination':which==='investigations'?'assessment':'history';
      if(which==='vitals'){
        const chart=await api.patientChart(patientId,controller.signal);
        if(chart.observations.access!=='available')throw Error('Observation access is restricted.');
        text=chart.observations.items.map(item=>`${item.code.replaceAll('-',' ')}: ${item.value??'Value not recorded'} ${item.unit??''} — ${new Date(item.takenAt).toLocaleString()} (source: ${item.origin})${item.assessment?`; screening: ${item.assessment.label} (${item.assessment.ruleVersion})`:''}`).join('\n');
        const derived=chart.observations.derived?.filter(item=>item.value!==null).map(item=>`${item.label}: ${item.value} ${item.unit} — ${item.category}; measured ${item.measuredAt?new Date(item.measuredAt).toLocaleString():'time not recorded'}; formula: ${item.formula}; ${item.ruleVersion}`).join('\n');
        if(derived)text=[text,`Calculated indicators (formula-based):\n${derived}`].filter(Boolean).join('\n\n');
      }else{
        const page=await api.chartHistory(patientId,which,undefined,controller.signal);
        const rows=which==='medications'?page.items.filter(item=>['prescribed','verified','dispensed','held'].includes(item.status)):which==='entries'?page.items.filter(item=>item.status==='active'):page.items.filter(item=>item.diagnostic?.results.length||item.diagnostic?.report);
        text=rows.map(item=>{
          const details=which==='investigations'?item.diagnostic?.report?`Final report v${item.diagnostic.report.version}: ${item.diagnostic.report.text}`:item.diagnostic?.results.map(result=>`${result.component}: ${result.value} ${result.unit??''} (${result.flag??'not assessed'}, v${result.version}; recorded ${new Date(result.recordedAt).toLocaleString()})`).join('; '):item.fields.filter(field=>field.value&&['Type','Dose','Route','Frequency','Hold reason'].includes(field.label)).map(field=>`${field.label}: ${field.value}`).join('; ');
          return `${item.title} — ${item.status}; ${which==='investigations'?'ordered':'recorded'} ${new Date(item.occurredAt).toLocaleString()}${details?`; ${details}`:''}`;
        }).join('\n');
        if(text)text=`From the recent ${which==='investigations'?'verified findings':which} register${page.nextCursor?' (limited to the latest 25 records)':''}:\n${text}`;
      }
      if(controller.signal.aborted)return;
      setPreview({title:which==='entries'?'Problems & allergies':which==='investigations'?'Verified findings':which==='vitals'?'Recorded observations':'Medication history',text:text||'No eligible records available for insertion. This is not a confirmed negative finding.',target});
    }catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not load chart context.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  function keyboard(event:React.KeyboardEvent<HTMLButtonElement>,index:number){
    const next=event.key==='ArrowRight'?(index+1)%4:event.key==='ArrowLeft'?(index+3)%4:event.key==='Home'?0:event.key==='End'?3:null;
    if(next===null)return;event.preventDefault();onSectionChange(sections[next].id);document.getElementById(`note-tab-${sections[next].id}`)?.focus();
  }
  return <div className="note-workspace"><div className="note-workspace__main">
    <div className="note-soap-tabs" role="tablist" aria-label="Clinical note sections">{sections.map((item,index)=><button id={`note-tab-${item.id}`} key={item.id} type="button" role="tab" aria-selected={section===item.id} aria-controls={`note-panel-${item.id}`} tabIndex={section===item.id?0:-1} onKeyDown={event=>keyboard(event,index)} onClick={()=>onSectionChange(item.id)}>{item.label}<span className={values[item.field].trim()?'is-documented':''} aria-label={values[item.field].trim()?'Has text':'Empty section'}/></button>)}</div>
    <div className="note-writing-status"><span>{kind==='nursing'?'Nursing documentation':'Consultation documentation'}</span><small>Formatted clinical record</small></div>
    {sections.map(item=><section className="note-soap-panel" key={item.id} id={`note-panel-${item.id}`} role="tabpanel" aria-labelledby={`note-tab-${item.id}`} hidden={section!==item.id}>
      {item.id==='subjective'?<label className="note-field"><span>Chief complaint <small>Required</small></span><input name="chiefComplaint" autoComplete="off" value={values.chiefComplaint} maxLength={2000} disabled={busy} onChange={event=>onChange({...values,chiefComplaint:event.target.value})} placeholder="Reason for this encounter"/></label>:null}
      <label className="note-field"><span>{item.id==='subjective'?'History of present illness & relevant history':item.id==='objective'?'Examination & observed findings':item.id==='assessment'?'Clinical assessment':'Care plan & follow-up'}<small>{values[item.field].length.toLocaleString()} / 10,000</small></span><RichNoteEditor name={item.field} label={item.label+' note'} value={values[item.field]} document={values.richText?.[item.field as 'history']} disabled={busy} onChange={(text,document)=>onChange({...values,[item.field]:text,richText:{...values.richText,[item.field]:document}})}/></label>
      <div className="note-section-prompts"><h3>Add a section heading</h3><p>Prompts only — no findings are assumed.</p><div>{(item.id==='subjective'?['Review of systems','Past medical history','Surgical history','Family history','Social history']:item.id==='objective'?['General examination','System examination','Recorded observations']:item.id==='assessment'?['Clinical impression','Differential considerations','Outstanding questions']:['Management plan','Follow-up','Patient discussion','Safety-net advice']).map(prompt=><button type="button" disabled={busy} key={prompt} onClick={()=>append({[item.field]:`${prompt}:\n`})}>＋ {prompt}</button>)}</div></div>
    </section>)}
  </div><aside className="note-workspace__rail" aria-label="Documentation tools"><section><h3><RecordIcon kind="documents" size={16}/>Templates</h3><label className="note-template-search"><span className="sr-only">Search note templates</span><input type="search" placeholder="Search templates" value={search} onChange={event=>setSearch(event.target.value)} disabled={busy}/></label><div className="note-template-list">{templates.filter(item=>item.kind===kind&&item.name.toLowerCase().includes(search.toLowerCase())).map(item=><button type="button" key={item.id} disabled={busy} aria-pressed={template===item.id} onClick={()=>{request.current?.abort();setLoading(false);setTemplate(item.id);setPreview(null);setError(null);}}><RecordIcon kind="notes" size={14}/>{item.name}</button>)}</div><p className="note-rail-hint">Built-in documentation prompts. Existing text is kept.</p></section>
    <section><h3><RecordIcon kind="vitals" size={16}/>Insert chart context</h3><p className="note-rail-hint">Preview recorded information before adding it.</p><div className="note-insert-list">{([{id:'vitals',label:'Vitals',icon:'vitals',allow:privileges.includes('observation:read')},{id:'medications',label:'Medications',icon:'medications',allow:privileges.includes('medication:read')},{id:'entries',label:'Problems & allergies',icon:'entries',allow:privileges.includes('entry:read')},{id:'investigations',label:'Verified investigations',icon:'investigations',allow:privileges.some(privilege=>['lab:read','imaging:view'].includes(privilege))}] as const).filter(item=>item.allow).map(item=><button key={item.id} type="button" disabled={busy||loading} onClick={()=>void context(item.id)}><RecordIcon kind={item.icon} size={15}/>{item.label}<span>＋</span></button>)}</div></section>
    {loading?<p role="status" className="note-rail-hint">Loading chart context…</p>:null}
    {error?<p role="alert" className="note-tool-error">{error}</p>:null}
    {selected?<section className="note-template-preview"><h3>{selected.name}</h3><p className="note-rail-hint">Adds blank headings to the four SOAP sections. No clinical findings or treatment are prefilled.</p><pre>{[selected.history,selected.examination,selected.assessment,selected.plan].join('\n\n')}</pre><button type="button" className="note-tool-apply" disabled={busy} onClick={()=>append({history:selected.history,examination:selected.examination,assessment:selected.assessment,plan:selected.plan})}>Append template</button></section>:null}
    {preview?<section className="note-context-preview"><h3>{preview.title}</h3><p className="note-rail-hint">Review for relevance and accuracy before inserting.</p><pre>{preview.text}</pre><label>Insert into<select value={preview.target} disabled={busy} onChange={event=>setPreview({...preview,target:event.target.value as keyof StaffNoteContent})}>{sections.map(item=><option key={item.id} value={item.field}>{item.label}</option>)}</select></label><button type="button" className="note-tool-apply" disabled={busy||preview.text.startsWith('No eligible records')} onClick={()=>{append({[preview.target]:`Chart context — ${preview.title}:\n${preview.text}`});onSectionChange(sections.find(item=>item.field===preview.target)?.id??'subjective');}}>Append reviewed context</button></section>:null}
    <p className="note-rail-hint">Signing requires review of all sections. Imported text becomes part of your authored note.</p>
  </aside></div>;
}
