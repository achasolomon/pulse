import { redirect } from "next/navigation";
import { validatedSession } from "../../../lib/session.js";
import { CriticalWorkspace } from "../../../components/critical-followup.js";
import {canUseCriticalResults,canUseLaboratoryCriticalResults,canUseImagingHandoffs} from '../../../lib/workspace-navigation.mjs';
import {ImagingHandoffWorkspace} from '../../../components/imaging-handoff.js';
export default async function CriticalResultsPage() {
  const v = await validatedSession();
  if (!v) redirect("/login");
  const f = v.publicSession.facility;
  if (!f) return null;
  if(!canUseCriticalResults(f.privileges))return <div className="page-head"><div><h1>Critical follow-up unavailable</h1><p>Your current facility permissions do not allow this workflow.</p><a href="/">Return to workspace</a></div></div>;
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
      {canUseLaboratoryCriticalResults(f.privileges)?<CriticalWorkspace
        key={f.facilityId}
        facilityId={f.facilityId}
        privileges={f.privileges}
      />:null}
      {canUseImagingHandoffs(f.privileges)?<ImagingHandoffWorkspace key={'imaging-'+f.facilityId} facilityId={f.facilityId} privileges={f.privileges} personId={v.publicSession.personId}/>:null}
    </>
  );
}
