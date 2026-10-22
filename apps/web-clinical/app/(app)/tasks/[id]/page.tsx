import { redirect } from "next/navigation";
import { ApiError, type StaffAssignedTask } from "@pulse/api-client";
import { Alert, Card } from "@pulse/ui";
import { serverApi } from "../../../../lib/api.js";
import { validatedSession } from "../../../../lib/session.js";
export default async function TaskPage({ params }: { params: { id: string } }) {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  let task: StaffAssignedTask;
  try {
    task = await serverApi(verified.session.token).request(
      `/workflow/staff/tasks/${encodeURIComponent(params.id)}`,
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
        <a href="/notifications">Back to notifications</a>
        <Alert tone="error">
          {err instanceof ApiError
            ? err.message
            : "Task details are temporarily unavailable."}
        </Alert>
      </>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Assigned task</h1>
          <p>{facility.facilityName}</p>
        </div>
      </div>
      <Card title={task.kind}>
        <p>Status: {task.status}</p>
        <p>Assigned to you</p>
      </Card>
      <a href="/notifications">Back to notifications</a>
    </>
  );
}
