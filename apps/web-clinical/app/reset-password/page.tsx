import { PasswordRecovery } from "../../components/password-recovery.js";
export default function ResetPasswordPage() {
  return (
    <main className="recovery-page" id="main-content">
      <section className="recovery-card" aria-labelledby="reset-heading">
        <img
          className="auth-logo"
          src="/brand/logo-horizontal.png"
          alt="Pulse Connected Care"
          width={216}
          height={72}
        />
        <h1 id="reset-heading">Set a new password</h1>
        <p className="recovery-intro">
          Use at least 10 characters. This link expires after 20 minutes and
          works once.
        </p>
        <PasswordRecovery mode="reset" />
      </section>
    </main>
  );
}
