import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pulse Clinical',
  description: 'Pulse Connected Care — clinical operations shell',
};

const NAV = [
  'Dashboard',
  'Patients',
  'Appointments',
  'Encounters',
  'Clinical',
  'Laboratory',
  'Imaging',
  'Medications',
  'Nursing',
  'Referrals',
  'Inventory',
  'Billing',
  'Reports',
  'Administration',
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <h1>Pulse</h1>
            <nav>
              {NAV.map((item, i) => (
                <a key={item} href="#" className={i === 0 ? 'active' : ''}>
                  {item}
                </a>
              ))}
            </nav>
          </aside>
          <div className="main">
            <header className="topbar">
              <input
                type="search"
                placeholder="Search patients, encounters, staff… (Ctrl+K)"
                aria-label="Global search"
                disabled
              />
              <span className="facility">City General Hospital · Main Facility</span>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
