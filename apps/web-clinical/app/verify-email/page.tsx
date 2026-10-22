import { redirect } from "next/navigation";
import { validatedSession } from "../../lib/session.js";
import { PasswordRecovery } from "../../components/password-recovery.js";
export default async function VerifyEmailPage() {
  if (!(await validatedSession())) redirect("/login");
  return (
    <main className="recovery-page" id="main-content">
      <section className="recovery-card" aria-labelledby="verify-heading">
        <h1 id="verify-heading">Verify your recovery email</h1>
        <p className="recovery-intro">
          Confirm this email belongs to you. Stay signed in to the staff account
          that requested verification.
        </p>
        <PasswordRecovery mode="verify" />
      </section>
    </main>
  );
}
