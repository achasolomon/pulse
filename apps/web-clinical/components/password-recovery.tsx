"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Input } from "@pulse/ui";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
const api = createStaffWebApi();
export function PasswordRecovery({
  mode,
}: {
  mode: "request" | "reset" | "verify";
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [token, setToken] = useState("");
  const [loginId, setLoginId] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode === "request") return;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    window.history.replaceState(null, "", window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value))
      setError("This link is missing or invalid. Request a new link.");
  }, [mode]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === "reset" && secret !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "request") await api.requestPasswordReset(loginId);
      if (mode === "reset") await api.resetPassword(token, secret);
      if (mode === "verify") await api.verifyRecoveryEmail(token);
      setDone(true);
      setSecret("");
      setConfirm("");
      setToken("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach Pulse. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <>
        <Alert
          tone="success"
          title={
            mode === "request"
              ? "Check your inbox"
              : mode === "reset"
                ? "Password updated"
                : "Recovery email verified"
          }
        >
          {mode === "request"
            ? "If this staff account has a verified recovery email, a reset link will arrive there shortly."
            : mode === "reset"
              ? "Your previous sessions have been signed out. Sign in with your new password. MFA remains required if enabled."
              : "You can now use this email for password recovery."}
        </Alert>
        <a
          className="recovery-back"
          href={mode === "verify" ? "/account/security" : "/login"}
        >
          {mode === "verify" ? "Back to account security" : "Back to sign in"}
        </a>
      </>
    );
  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form method="post" className="auth-form" onSubmit={submit}>
        {mode === "request" ? (
          <Input
            label="Staff username"
            id="recovery-username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
          />
        ) : null}
        {mode === "reset" ? (
          <>
            <Input
              label="New password"
              id="reset-secret"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={200}
              required
              disabled={busy}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
            <Input
              label="Confirm new password"
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={200}
              required
              disabled={busy}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </>
        ) : null}
        <Button
          type="submit"
          className="auth-submit"
          loading={busy}
          disabled={
            !ready ||
            busy ||
            (mode !== "request" && !/^[A-Za-z0-9_-]{43}$/.test(token))
          }
        >
          {mode === "request"
            ? "Send reset link"
            : mode === "reset"
              ? "Update password"
              : "Verify email"}
        </Button>
      </form>
      <a
        className="recovery-back"
        href={mode === "verify" ? "/account/security" : "/login"}
      >
        {mode === "verify" ? "Back to account security" : "Back to sign in"}
      </a>
    </>
  );
}
