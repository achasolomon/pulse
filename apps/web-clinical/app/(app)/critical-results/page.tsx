import { redirect } from "next/navigation";
import { validatedSession } from "../../../lib/session.js";
import { CriticalWorkspace } from "../../../components/critical-followup.js";
export default async function CriticalResultsPage() {
  const v = await validatedSession();
  if (!v) redirect("/login");
  const f = v.publicSession.facility;
  if (!f) return null;
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Critical result follow-up</h1>
          <p>
            {f.facilityName} · Direct communication and clinical acknowledgement
          </p>
        </div>
      </div>
      <CriticalWorkspace
        key={f.facilityId}
        facilityId={f.facilityId}
        privileges={f.privileges}
      />
    </>
  );
}
