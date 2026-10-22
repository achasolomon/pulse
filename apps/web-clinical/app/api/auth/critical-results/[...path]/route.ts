import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function proxy(r:Request,path:string[]){
  let target:string|null=null;
  if(r.method==='GET'&&path.length===1&&path[0]==='count')target='/staff/critical-results/count';
  if(path[0]==='orders'&&uuid.test(path[1]??'')){
    if(r.method==='GET'&&(path.length===2||(path.length===3&&path[2]==='recipients')))target=`/staff/critical-results/${path.join('/')}`;
    if(r.method==='POST'&&path.length===3&&['notify','attempt','acknowledge','backup'].includes(path[2]!))target=`/staff/critical-results/${path.join('/')}`;
  }
  return target?staffWorkflowProxy(r,target):NextResponse.json({message:'Not found'},{status:404});
}
export function GET(r:Request,{params}:{params:{path:string[]}}){return proxy(r,params.path);}
export function POST(r:Request,{params}:{params:{path:string[]}}){return proxy(r,params.path);}
