import { redirect } from "next/navigation";
import { Alert } from "@pulse/ui";
import { validatedSession } from "../../../lib/session.js";
import { PatientWorklist } from "../../../components/patient-worklist.js";
export default async function PatientsPage() {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Patients</h1>
          <p>Patient records · {facility.facilityName}</p>
        </div>
      </div>
      {facility.privileges.includes("patient:read") ? (
        <PatientWorklist facilityId={facility.facilityId} privileges={facility.privileges} />
      ) : (
        <Alert tone="warning">
          Your account does not have access to the patient directory in this
          facility.
        </Alert>
      )}
    </>
  );
}
