import { NextResponse } from "next/server";
import { staffWorkflowProxy } from "../../../../../../../lib/staff-workflow-proxy.js";
export function GET(
  request: Request,
  { params }: { params: { id: string; section: string } },
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id,
    ) ||
    ![
      "visits",
      "vitals",
      "entries",
      "notes",
      "medications",
      "investigations",
      "documents",
      "profile",
    ].includes(params.section)
  )
    return NextResponse.json(
      { message: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["cursor", "encounterId"]) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  return staffWorkflowProxy(
    request,
    `/staff/charts/${params.id}/history/${params.section}?${query}`,
  );
}
