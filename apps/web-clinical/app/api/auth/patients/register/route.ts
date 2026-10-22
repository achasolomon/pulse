import { staffWorkflowProxy } from "../../../../../lib/staff-workflow-proxy.js";
export function POST(request: Request) { return staffWorkflowProxy(request, "/staff/patients/register"); }
