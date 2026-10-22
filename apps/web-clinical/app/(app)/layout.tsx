import type { ReactNode } from 'react';
import { Shell } from '../../components/shell.js';
import { redirect } from 'next/navigation';
import { validatedSession } from '../../lib/session.js';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const verified = await validatedSession();
  if (!verified) redirect('/login');
  return <Shell session={verified.publicSession}>{verified.publicSession.facility ? children : <div className="page-head"><div className="page-greeting"><h1>Welcome, {verified.publicSession.loginId}</h1><p>Choose a facility to open your workspace.</p></div></div>}</Shell>;
}
