import { NextResponse } from "next/server";
import { staffWorkflowProxy } from "../../../../../lib/staff-workflow-proxy.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function proxy(request: Request, path: string[]) {
  let target: string | null = null;
  if (request.method === "GET") {
    if (path.length === 1 && uuid.test(path[0]!))
      target = `/staff/notes/${path[0]}`;
    if (path.length === 2 && path[0] === "contexts" && uuid.test(path[1]!))
      target = `/staff/patients/${path[1]}/note-contexts`;
  } else if (path.length === 2) {
    if (path[0] === "patients" && uuid.test(path[1]!))
      target = `/staff/patients/${path[1]}/notes`;
    if (uuid.test(path[0]!) && ["save", "sign", "addenda"].includes(path[1]!))
      target = `/staff/notes/${path[0]}/${path[1]}`;
  }
  return target
    ? staffWorkflowProxy(request, target)
    : NextResponse.json(
        { message: "Not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
}
export function GET(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path);
}
export function POST(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path);
}
