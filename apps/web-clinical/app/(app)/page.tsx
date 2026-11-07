import {redirect} from 'next/navigation';
import {validatedSession} from '../../lib/session.js';
import {WorkspaceDashboard} from '../../components/workspace-dashboard.js';
export default async function WorkspaceHome(){
 const verified=await validatedSession();if(!verified)redirect('/login');
 const session=verified.publicSession;if(!session.facility)return null;
 return <WorkspaceDashboard key={session.facility.facilityId} facility={session.facility} loginId={session.loginId}/>;
}
