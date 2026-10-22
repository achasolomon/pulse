export type NoteDocument = {type:'doc';content:NoteNode[]};
export type NoteNode = {type:string;text?:string;attrs?:{level?:number;start?:number;type?:'1'|'a'|'A'|'i'|'I'|null};marks?:{type:string}[];content?:NoteNode[]};
export type NoteFormatting = Partial<Record<'history'|'examination'|'assessment'|'plan',NoteDocument>>;
export function validNoteDocument(value:unknown):value is NoteDocument;
export function noteDocumentText(document:NoteDocument):string;
export function plainNoteDocument(value:string):NoteDocument;
export function appendNoteDocument(existing:NoteDocument|undefined,plain:string,addition:string):NoteDocument;
