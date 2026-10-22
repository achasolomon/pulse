import { redirect } from "next/navigation";
import { ApiError, type StaffChartOverview } from "@pulse/api-client";
import { Alert } from "@pulse/ui";
import { validatedSession } from "../../../../lib/session.js";
import { serverApi } from "../../../../lib/api.js";
import { PatientRecord } from "../../../../components/patient-record.js";
export default async function PatientChartPage({
  params,
}: {
  params: { id: string };
}) {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  let chart: StaffChartOverview;
  try {
    chart = await serverApi(verified.session.token).request(
      `/staff/charts/${encodeURIComponent(params.id)}`,
      {
        headers: {
          "x-facility-id": facility.facilityId,
          "x-tenant-id": facility.organizationId,
        },
      },
    );
  } catch (err) {
    return (
      <>
        <a className="chart-back" href="/patients">
          Back to patients
        </a>
        <Alert tone="error">
          {err instanceof ApiError
            ? err.message
            : "Patient record is temporarily unavailable."}
        </Alert>
      </>
    );
  }
  return (
    <PatientRecord
      key={chart.patient.id}
      chart={chart}
      facilityName={facility.facilityName}
      personId={verified.publicSession.personId}
      privileges={facility.privileges}
    />
  );
}
