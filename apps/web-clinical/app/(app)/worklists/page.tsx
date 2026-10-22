import { redirect } from "next/navigation";
import { validatedSession } from "../../../lib/session.js";
import { ClinicalWorklists } from "../../../components/clinical-worklists.js";
export default async function WorklistsPage() {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Staff worklists</h1>
          <p>Clinical & laboratory operations · {facility.facilityName}</p>
        </div>
      </div>
      <ClinicalWorklists
        personId={verified.publicSession.personId}
        facilityId={facility.facilityId}
        privileges={facility.privileges}
      />
    </>
  );
}
