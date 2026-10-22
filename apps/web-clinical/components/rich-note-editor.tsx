"use client";
import {useEffect,useRef,useState} from 'react';
import {EditorContent,useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {noteDocumentText,plainNoteDocument,validNoteDocument,type NoteDocument,type NoteNode} from '@pulse/api-client';
export function RichNoteView({document}:{document:NoteDocument}){
  if(!validNoteDocument(document))return null;
  function render(node:NoteNode,key:number):React.ReactNode {
    if(node.type==='text'){
      let value:React.ReactNode=node.text;
      for(const mark of node.marks??[])value=mark.type==='bold'?<strong>{value}</strong>:mark.type==='italic'?<em>{value}</em>:mark.type==='underline'?<u>{value}</u>:mark.type==='strike'?<s>{value}</s>:value;
      return <span key={key}>{value}</span>;
    }
    const children=node.content?.map(render);
    switch(node.type){case 'doc':return <div key={key}>{children}</div>;case 'heading':return node.attrs?.level===1?<h2 key={key}>{children}</h2>:node.attrs?.level===2?<h3 key={key}>{children}</h3>:<h4 key={key}>{children}</h4>;case 'bulletList':return <ul key={key}>{children}</ul>;case 'orderedList':return <ol key={key} start={node.attrs?.start??1}>{children}</ol>;case 'listItem':return <li key={key}>{children}</li>;case 'blockquote':return <blockquote key={key}>{children}</blockquote>;case 'hardBreak':return <br key={key}/>;case 'horizontalRule':return <hr key={key}/>;default:return <p key={key}>{children}</p>;}
  }
  return <div className="note-rich-view">{render(document,0)}</div>;
}
export function RichNoteEditor({name,label,value,document,disabled,onChange}:{name:string;label:string;value:string;document?:NoteDocument;disabled:boolean;onChange:(text:string,document:NoteDocument)=>void}){
  const [error,setError]=useState<string|null>(null);
  const accepted=useRef<NoteDocument>(document??plainNoteDocument(value));
  const change=useRef(onChange);change.current=onChange;
  const editor=useEditor({extensions:[StarterKit.configure({link:false,code:false,codeBlock:false,heading:{levels:[1,2,3]}})],immediatelyRender:false,shouldRerenderOnTransaction:true,content:accepted.current,editorProps:{attributes:{role:'textbox','aria-label':label,'aria-multiline':'true','data-note-field':name}},onUpdate:({editor})=>{
    const next=editor.getJSON() as NoteDocument;
    const plain=noteDocumentText(next);
    if(!validNoteDocument(next)||plain.length>10000||JSON.stringify(next).length>45000){editor.commands.setContent(accepted.current,{emitUpdate:false});setError('This section exceeds its text or formatting limit.');return;}
    accepted.current=next;setError(null);change.current(plain,next);
  }},[name]);
  useEffect(()=>{if(editor)editor.setEditable(!disabled,false);},[editor,disabled]);
  useEffect(()=>{if(!editor)return;const next=document??plainNoteDocument(value);if(JSON.stringify(editor.getJSON())!==JSON.stringify(next)){editor.commands.setContent(next,{emitUpdate:false});accepted.current=next;}},[editor,value,document]);
  const button=(label:string,text:React.ReactNode,action:()=>void,active=false,unavailable=false)=><button type="button" key={label} aria-label={label} title={label} aria-pressed={active} disabled={disabled||!editor||unavailable} onMouseDown={event=>event.preventDefault()} onClick={action}>{text}</button>;
  return <div className="rich-note-editor"><div className="rich-note-toolbar" role="group" aria-label={`${label} formatting`}>
    <select aria-label="Text style" value={editor?.isActive('heading',{level:1})?'1':editor?.isActive('heading',{level:2})?'2':editor?.isActive('heading',{level:3})?'3':'paragraph'} disabled={disabled||!editor} onChange={event=>event.target.value==='paragraph'?editor?.chain().focus().setParagraph().run():editor?.chain().focus().toggleHeading({level:Number(event.target.value) as 1|2|3}).run()}><option value="paragraph">Normal text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option></select>
    {button('Bold',<b>B</b>,()=>editor?.chain().focus().toggleBold().run(),editor?.isActive('bold'))}
    {button('Italic',<i>I</i>,()=>editor?.chain().focus().toggleItalic().run(),editor?.isActive('italic'))}
    {button('Underline',<u>U</u>,()=>editor?.chain().focus().toggleUnderline().run(),editor?.isActive('underline'))}
    {button('Strikethrough',<s>S</s>,()=>editor?.chain().focus().toggleStrike().run(),editor?.isActive('strike'))}
    <span className="rich-note-toolbar__divider"/>
    {button('Bulleted list','• ≡',()=>editor?.chain().focus().toggleBulletList().run(),editor?.isActive('bulletList'))}
    {button('Numbered list','1. ≡',()=>editor?.chain().focus().toggleOrderedList().run(),editor?.isActive('orderedList'))}
    {button('Decrease indent','⇤',()=>editor?.chain().focus().liftListItem('listItem').run(),false,!editor?.can().liftListItem('listItem'))}
    {button('Increase indent','⇥',()=>editor?.chain().focus().sinkListItem('listItem').run(),false,!editor?.can().sinkListItem('listItem'))}
    {button('Block quote','❞',()=>editor?.chain().focus().toggleBlockquote().run(),editor?.isActive('blockquote'))}
    {button('Clear formatting','Tx',()=>editor?.chain().focus().unsetAllMarks().clearNodes().run())}
    <span className="rich-note-toolbar__divider"/>
    {button('Undo','↶',()=>editor?.chain().focus().undo().run(),false,!editor?.can().undo())}
    {button('Redo','↷',()=>editor?.chain().focus().redo().run(),false,!editor?.can().redo())}
  </div><EditorContent editor={editor}/>{error?<p role="alert" className="note-tool-error">{error}</p>:null}</div>;
}
