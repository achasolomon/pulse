export default function Dashboard() {
  return (
    <>
      <div className="patient-banner" role="status">
        No patient selected — select a patient to pin the context banner (UX-001:
        persistent patient context).
      </div>
      <main className="content">
        <h2 style={{ margin: '0 0 12px' }}>Good morning — Sprint 01 shell</h2>
        <p style={{ color: 'var(--pulse-slate)', marginTop: 0 }}>
          Static shell only. Worklists, encounter actions, and API wiring land
          with the R1 vertical slice.
        </p>
        <div className="cards">
          <div className="card">
            <h2>Appointments</h2>
            <p>—</p>
          </div>
          <div className="card">
            <h2>In Queue</h2>
            <p>—</p>
          </div>
          <div className="card">
            <h2>Admitted</h2>
            <p>—</p>
          </div>
          <div className="card">
            <h2>Critical Results</h2>
            <p>—</p>
          </div>
          <div className="card">
            <h2>Tasks</h2>
            <p>—</p>
          </div>
        </div>
      </main>
    </>
  );
}
