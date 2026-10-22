import { Card, Alert } from '@pulse/ui';
import { redirect } from 'next/navigation';
import { validatedSession } from '../../lib/session.js';
export default async function WorkspaceHome() {
  const verified = await validatedSession();
  if (!verified) redirect('/login');
  const facility = verified.publicSession.facility;
  if (!facility) return null;
  return <>
    {['lab:read','lab:worklist'].every(p=>facility.privileges.includes(p))?<Card title="Laboratory requests"><p>Review incoming requests, collect specimens and record laboratory receipt.</p><a href="/worklists">Open laboratory worklist</a></Card>:null}
    {facility.privileges.includes('encounter:read') && ['appointment:read','observation:write','encounter:consult'].some(p=>facility.privileges.includes(p)) ? <Card title="Patient flow"><p>Follow checked-in patients through vitals and consultation.</p><a href="/worklists">Open staff worklists</a></Card> : null}
    <div className="page-head"><div className="page-greeting">
      <h1>Welcome, {verified.publicSession.loginId}</h1>
      <p>{facility.facilityName} · {facility.organizationName}</p>
    </div></div>
    <Alert tone="info" title="Your facility workspace">
      Use the navigation to open available work areas. Your current facility and staff access are shown below.
    </Alert>
    <Card title="Your access"><p>Roles: {facility.roles.length ? facility.roles.join(', ') : 'No role assigned'}</p>
      {verified.publicSession.facilities.length > 1 ? <p>Use the facility selector in the header to switch workspace.</p> : null}
    </Card>
    {facility.privileges.includes('patient:read') ? <Card title="Patients"><p>Find patient records in this facility and open an authorized patient overview.</p><a href="/patients">Open patient directory →</a></Card> : null}
  </>;
}
