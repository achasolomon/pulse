import {staffWorkflowProxy} from '../../../../lib/staff-workflow-proxy.js';
export function GET(r:Request){const cursor=new URL(r.url).searchParams.get('cursor');return staffWorkflowProxy(r,`/staff/critical-results${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);}
