import { redirect } from "next/navigation";
import { validatedSession } from "../../../lib/session.js";
import { ClinicalWorklists } from "../../../components/clinical-worklists.js";
import {worklistTabs} from '../../../lib/workspace-navigation.mjs';
export default async function WorklistsPage({searchParams}:{searchParams:{queue?:string;order?:string}}) {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  const tabs=worklistTabs(facility.privileges);
  const selected=tabs.find(tab=>tab.id===searchParams.queue) ?? (!searchParams.queue?tabs[0]:undefined);
  if(!selected)return <div className="page-head"><div><h1>Worklist unavailable</h1><p>Your current facility permissions do not allow this worklist.</p><a href="/">Return to workspace</a></div></div>;
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>{selected.label}</h1>
          <p>{facility.facilityName}</p>
        </div>
      </div>
      <ClinicalWorklists
        key={facility.facilityId+selected.id}
        initialQueue={selected.id}
        initialOrderId={searchParams.order&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(searchParams.order)?searchParams.order:undefined}
        personId={verified.publicSession.personId}
        facilityId={facility.facilityId}
        privileges={facility.privileges}
      />
    </>
  );
}
