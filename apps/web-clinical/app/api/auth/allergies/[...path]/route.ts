import {NextResponse} from 'next/server';
import {staffWorkflowProxy} from '../../../../../lib/staff-workflow-proxy.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function proxy(request:Request,path:string[]){
  let target:string|null=null;
  if(uuid.test(path[0]??'')){
    const base=`/staff/patients/${path[0]}/allergies`;
    if(request.method==='GET'&&path.length===1)target=base;
    if(request.method==='POST'){
      if(path.length===2&&path[1]==='add')target=base;
      if(path.length===2&&path[1]==='review')target=`${base}/review`;
      if(path.length===3&&uuid.test(path[1]!)&&path[2]==='entered-in-error')target=`${base}/${path[1]}/entered-in-error`;
    }
  }
  return target?staffWorkflowProxy(request,target):NextResponse.json({message:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
export function GET(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
export function POST(request:Request,{params}:{params:{path:string[]}}){return proxy(request,params.path);}
