import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function proxy(request:Request,path:string[]){let target:string|null=null;
 if(request.method==='GET'&&path.length===1&&['count','queue'].includes(path[0]!)){const query=new URLSearchParams();const cursor=new URL(request.url).searchParams.get('cursor');if(path[0]==='queue'&&cursor)query.set('cursor',cursor);target=`/staff/imaging-handoffs/${path[0]}?${query}`;}
 if(path[0]==='orders'&&uuid.test(path[1]??'')){
  if(request.method==='GET'&&(path.length===2||(path.length===3&&path[2]==='recipients')))target='/staff/imaging-handoffs/'+path.join('/');
  if(request.method==='POST'&&path.length===3&&['start','contact','acknowledge'].includes(path[2]!))target='/staff/imaging-handoffs/'+path.join('/');
 }return target?staffWorkflowProxy(request,target):NextResponse.json({message:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
export function GET(r:Request,{params}:{params:{path:string[]}}){return proxy(r,params.path);}
export function POST(r:Request,{params}:{params:{path:string[]}}){return proxy(r,params.path);}
