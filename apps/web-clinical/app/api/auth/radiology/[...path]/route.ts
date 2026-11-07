import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function proxy(request:Request,path:string[]){
  let target:string|null=null;
  if(path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&((request.method==='GET'&&path[2]==='reports')||(request.method==='POST'&&['report-drafts','report-signoff'].includes(path[2]!))))target=`/staff/radiology/orders/${path[1]}/${path[2]}`;
  if(path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&((request.method==='GET'&&path[2]==='acquisition')||(request.method==='POST'&&['acquisition-prepare','acquisition-confirm'].includes(path[2]!))))target=`/staff/radiology/orders/${path[1]}/${path[2]}`;
  if(request.method==='GET'){
    if(path.length===2&&path[0]==='pacs'&&path[1]==='status')target='/staff/radiology/pacs/status';
    if(path.length===1&&path[0]==='queue'){const input=new URL(request.url).searchParams,query=new URLSearchParams();for(const key of ['q','status','cursor']){const value=input.get(key);if(value)query.set(key,value);}target=`/staff/radiology/queue?${query}`;}
    if(path.length===2&&path[0]==='orders'&&uuid.test(path[1]!))target=`/staff/radiology/orders/${path[1]}`;
    if(path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&path[2]==='protocols')target=`/staff/radiology/orders/${path[1]}/protocols`;
    if(path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&path[2]==='readiness')target=`/staff/radiology/orders/${path[1]}/readiness`;
    if(path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&path[2]==='slots'){const input=new URL(request.url).searchParams,query=new URLSearchParams();for(const key of ['from','to']){const value=input.get(key);if(value)query.set(key,value);}target=`/staff/radiology/orders/${path[1]}/slots?${query}`;}
  }
  if(request.method==='POST'&&path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&path[2]==='protocol-reviews')target=`/staff/radiology/orders/${path[1]}/protocol-reviews`;
  if(request.method==='POST'&&path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&path[2]==='schedule')target=`/staff/radiology/orders/${path[1]}/schedule`;
  if(request.method==='POST'&&path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&['reschedule','appointment-cancel'].includes(path[2]!))target=`/staff/radiology/orders/${path[1]}/${path[2]}`;
  if(request.method==='POST'&&path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&['arrive','no-show'].includes(path[2]!))target=`/staff/radiology/orders/${path[1]}/${path[2]}`;
  return target?staffWorkflowProxy(request,target):NextResponse.json({message:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
export function GET(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
export function POST(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
