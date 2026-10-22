import { NextResponse } from "next/server";
import { ApiError } from "@pulse/api-client";
import { serverApi } from "../../../../../lib/api.js";
import { validatedSession } from "../../../../../lib/session.js";
import { isSameOrigin } from "../../../../../lib/csrf.js";
const headers = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function proxy(request: Request, path: string[], mutation: boolean) {
  if (mutation && !isSameOrigin(request))
    return NextResponse.json(
      { message: "Cross-origin request rejected" },
      { status: 403, headers },
    );
  const allowed = mutation
    ? path.length === 3 &&
      path[0] === "notifications" &&
      UUID.test(path[1] ?? "") &&
      path[2] === "read"
    : (path.length === 1 && path[0] === "notifications") ||
      (path.length === 2 && path[0] === "tasks" && UUID.test(path[1] ?? ""));
  if (!allowed)
    return NextResponse.json(
      { message: "Not found" },
      { status: 404, headers },
    );
  try {
    const verified = await validatedSession();
    if (!verified)
      return NextResponse.json(
        { message: "Please sign in again" },
        { status: 401, headers },
      );
    const facility = verified.publicSession.facility;
    if (!facility)
      return NextResponse.json(
        { message: "Select a facility first" },
        { status: 403, headers },
      );
    const query = new URLSearchParams();
    if (!mutation && path.length === 1) {
      const source = new URL(request.url).searchParams;
      if (source.get("unread") === "true") query.set("unread", "true");
      if (source.has("cursor")) query.set("cursor", source.get("cursor")!);
    }
    const result = await serverApi(verified.session.token).request(
      `/workflow/staff/${path.join("/")}${query.size ? `?${query}` : ""}`,
      {
        method: mutation ? "POST" : "GET",
        headers: {
          "x-facility-id": facility.facilityId,
          "x-tenant-id": facility.organizationId,
        },
      },
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof ApiError
            ? error.message
            : "Notifications are temporarily unavailable",
        ...(error instanceof ApiError
          ? {
              code: error.code,
              kind: error.kind,
              correlationId: error.correlationId,
            }
          : {}),
      },
      {
        status: error instanceof ApiError && error.status ? error.status : 503,
        headers,
      },
    );
  }
}
export function GET(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path, false);
}
export function POST(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path, true);
}
