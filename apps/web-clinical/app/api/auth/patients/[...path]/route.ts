import { NextResponse } from "next/server";
import { ApiError } from "@pulse/api-client";
import { validatedSession } from "../../../../../lib/session.js";
import { serverApi } from "../../../../../lib/api.js";
import { isSameOrigin } from "../../../../../lib/csrf.js";
const headers = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function proxy(request: Request, path: string[], search: boolean) {
  let query = new URLSearchParams();
  if (search) {
    if (!isSameOrigin(request))
      return NextResponse.json(
        { message: "Cross-origin request rejected" },
        { status: 403, headers },
      );
    if (path.length !== 1 || path[0] !== "search")
      return NextResponse.json(
        { message: "Not found" },
        { status: 404, headers },
      );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: "Invalid search" },
        { status: 400, headers },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json(
        { message: "Invalid search" },
        { status: 400, headers },
      );
    const input = body as Record<string, unknown>;
    if (
      typeof input.query !== "string" ||
      input.query.length > 100 ||
      typeof input.status !== "string" ||
      !["active", "all", "retired-duplicate"].includes(input.status) ||
      (input.cursor !== undefined &&
        (typeof input.cursor !== "string" || !UUID.test(input.cursor)))
    )
      return NextResponse.json(
        { message: "Invalid search" },
        { status: 400, headers },
      );
    query = new URLSearchParams({ q: input.query, status: input.status });
    if (typeof input.cursor === "string") query.set("cursor", input.cursor);
  } else if (
    path.length !== 2 ||
    !UUID.test(path[0] ?? "") ||
    path[1] !== "chart"
  )
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
    const result = await serverApi(verified.session.token).request(
      search ? `/staff/patients?${query}` : `/staff/charts/${path[0]}`,
      {
        signal: request.signal,
        headers: {
          "x-facility-id": facility.facilityId,
          "x-tenant-id": facility.organizationId,
        },
      },
    );
    return NextResponse.json(result, { headers });
  } catch (err) {
    return NextResponse.json(
      {
        message:
          err instanceof ApiError
            ? err.message
            : "Patient records are temporarily unavailable",
        ...(err instanceof ApiError
          ? { code: err.code, kind: err.kind, correlationId: err.correlationId }
          : {}),
      },
      {
        status: err instanceof ApiError && err.status ? err.status : 503,
        headers,
      },
    );
  }
}
export function POST(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path, true);
}
export function GET(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  return proxy(request, params.path, false);
}
