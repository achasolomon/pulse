import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function proxy(request:Request,path:string[]){
  let target:string|null=null;
  if(uuid.test(path[0]??'')){
    const base=`/staff/patients/${path[0]}/lab`;
    if(request.method==='GET'){
      if(path.length===2&&['contexts','catalogue'].includes(path[1]!))target=`${base}/${path[1]}${path[1]==='catalogue'?'?q='+encodeURIComponent(new URL(request.url).searchParams.get('q')??''):''}`;
      if(path.length===3&&path[1]==='orders'&&uuid.test(path[2]!))target=`${base}/orders/${path[2]}`;
    }
    if(request.method==='POST'){
      if(path.length===2&&path[1]==='orders')target=`${base}/orders`;
      if(path.length===4&&path[1]==='orders'&&uuid.test(path[2]!)&&path[3]==='cancel')target=`${base}/orders/${path[2]}/cancel`;
    }
  }
  return target?staffWorkflowProxy(request,target):NextResponse.json({message:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
export function GET(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
export function POST(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
