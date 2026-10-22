import { redirect } from "next/navigation";
import { validatedSession } from "../../../lib/session.js";
import { NotificationCentre } from "../../../components/notification-centre.js";
export default async function NotificationsPage() {
  const verified = await validatedSession();
  if (!verified) redirect("/login");
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  return (
    <>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Notifications</h1>
          <p>{facility.facilityName}</p>
        </div>
      </div>
      <NotificationCentre full facilityId={facility.facilityId} />
    </>
  );
}
