import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function proxy(request:Request,path:string[]){
  let target:string|null=null;
  if(request.method==='GET'){
    if(path.length===1&&path[0]==='queue'){const input=new URL(request.url).searchParams,query=new URLSearchParams();for(const key of ['q','status','cursor']){const value=input.get(key);if(value)query.set(key,value);}target=`/staff/laboratory/queue?${query}`;}
    if(path.length===2&&path[0]==='orders'&&uuid.test(path[1]!))target=`/staff/laboratory/orders/${path[1]}`;
  }
  if(request.method==='POST'&&path.length===3&&path[0]==='orders'&&uuid.test(path[1]!)&&['collect','accession','results','verify'].includes(path[2]!))target=`/staff/laboratory/orders/${path[1]}/${path[2]}`;
  return target?staffWorkflowProxy(request,target):NextResponse.json({message:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
export function GET(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
export function POST(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
