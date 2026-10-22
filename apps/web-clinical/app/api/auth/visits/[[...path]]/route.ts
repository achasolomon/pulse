import { NextResponse } from "next/server";
import { staffWorkflowProxy } from "../../../../../lib/staff-workflow-proxy.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function proxy(request: Request, path: string[] = []) {
  const valid =
    request.method === "GET"
      ? !path.length ||
        (path.length === 1 &&
          (path[0] === "clinicians" || uuid.test(path[0]!))) ||
        (path.length === 2 && path[0] === "patient" && uuid.test(path[1]!))
      : (path.length === 1 && path[0] === "check-in") ||
        (path.length === 2 &&
          uuid.test(path[0]!) &&
          ["claim", "vitals", "handoff", "start"].includes(path[1]!));
  if (!valid)
    return NextResponse.json(
      { message: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  const query = new URL(request.url).searchParams.get("queue");
  return staffWorkflowProxy(
    request,
    `/staff/visits${path.length ? "/" + path.join("/") : query ? "?queue=" + encodeURIComponent(query) : ""}`,
  );
}
export function GET(
  request: Request,
  { params }: { params: { path?: string[] } },
) {
  return proxy(request, params.path);
}
export function POST(
  request: Request,
  { params }: { params: { path?: string[] } },
) {
  return proxy(request, params.path);
}
