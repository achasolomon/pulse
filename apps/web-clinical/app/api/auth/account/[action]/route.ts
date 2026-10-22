import { NextResponse } from "next/server";
import { ApiError } from "@pulse/api-client";
import { serverApi } from "../../../../../lib/api.js";
import { isSameOrigin } from "../../../../../lib/csrf.js";
import {
  validatedSession,
  SESSION_COOKIE,
} from "../../../../../lib/session.js";
const actions: Record<string, string> = {
  "password-request": "password/request",
  "password-reset": "password/reset",
  "email-request": "email/request",
  "email-verify": "email/verify",
  "mfa-enroll": "mfa/enroll",
  "mfa-confirm": "mfa/confirm",
  "mfa-disable": "mfa/disable",
};
const headers = { "Cache-Control": "no-store" };
function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      message:
        error instanceof ApiError
          ? error.message
          : "Account security is temporarily unavailable",
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
export async function GET(
  _request: Request,
  { params }: { params: { action: string } },
) {
  if (params.action !== "security")
    return NextResponse.json(
      { message: "Not found" },
      { status: 404, headers },
    );
  try {
    const session = await validatedSession();
    if (!session)
      return NextResponse.json(
        { message: "Please sign in again" },
        { status: 401, headers },
      );
    return NextResponse.json(
      await serverApi(session.session.token).request(
        "/iam/auth/account/security",
      ),
      { headers },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
export async function POST(
  request: Request,
  { params }: { params: { action: string } },
) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { message: "Cross-origin request rejected" },
      { status: 403, headers },
    );
  const path = actions[params.action];
  if (!path)
    return NextResponse.json(
      { message: "Not found" },
      { status: 404, headers },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400, headers },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400, headers },
    );
  try {
    const isPublic =
      params.action === "password-request" ||
      params.action === "password-reset";
    const session = isPublic ? null : await validatedSession();
    if (!isPublic && !session)
      return NextResponse.json(
        { message: "Please sign in again" },
        { status: 401, headers },
      );
    const result = await serverApi(session?.session.token).request(
      `/iam/auth/account/${path}`,
      { method: "POST", body },
    );
    const response = NextResponse.json(result, { headers });
    if (
      ["password-reset", "mfa-confirm", "mfa-disable"].includes(params.action)
    )
      response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
