import { NextResponse } from "next/server";
import { ApiError } from "@pulse/api-client";
import { validatedSession } from "./session.js";
import { serverApi } from "./api.js";
import { isSameOrigin } from "./csrf.js";
export async function staffWorkflowProxy(request: Request, path: string) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "GET" && !isSameOrigin(request))
    return NextResponse.json(
      { message: "Cross-origin request rejected" },
      { status: 403, headers },
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
    let body: unknown;
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { message: "Invalid request" },
          { status: 400, headers },
        );
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return NextResponse.json(
          { message: "Invalid request" },
          { status: 400, headers },
        );
    }
    const result = await serverApi(verified.session.token).request(path, {
      method: request.method === "POST" ? "POST" : "GET",
      body,
      signal: request.signal,
      headers: {
        "x-facility-id": facility.facilityId,
        "x-tenant-id": facility.organizationId,
      },
    });
    return NextResponse.json(result ?? null, { headers });
  } catch (err) {
    return NextResponse.json(
      {
        message:
          err instanceof ApiError
            ? err.message
            : "This action is temporarily unavailable",
        ...(err instanceof ApiError
          ? {
              detail: err.message,
              code: err.code,
              correlationId: err.correlationId,
            }
          : {}),
      },
      {
        status: err instanceof ApiError && err.status ? err.status : 503,
        headers,
      },
    );
  }
}
