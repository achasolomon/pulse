import { PasswordRecovery } from "../../components/password-recovery.js";
export default function ForgotPasswordPage() {
  return (
    <main className="recovery-page" id="main-content">
      <section className="recovery-card" aria-labelledby="recovery-heading">
        <img
          className="auth-logo"
          src="/brand/logo-horizontal.png"
          alt="Pulse Connected Care"
          width={216}
          height={72}
        />
        <h1 id="recovery-heading">Forgot your password?</h1>
        <p className="recovery-intro">
          Enter your staff username. We’ll send a reset link to the verified
          recovery email on your account.
        </p>
        <PasswordRecovery mode="request" />
        <p className="recovery-note">
          If you have not verified a recovery email, contact your facility
          administrator.
        </p>
      </section>
    </main>
  );
}
