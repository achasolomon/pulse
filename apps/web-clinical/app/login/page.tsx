"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "@pulse/ui";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
const api = createStaffWebApi();

export default function LoginPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [phase, setPhase] = useState<"credentials" | "totp">("credentials");
  const [loginId, setLoginId] = useState("");
  const [secret, setSecret] = useState("");
  const [totp, setTotp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const returnToUsername = useRef(false);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  useEffect(() => {
    const security = new URL(window.location.href).searchParams.get("security");
    if (security === "mfa-enabled")
      setSecurityNotice(
        "MFA is enabled. Sign in with your password, then your authenticator code.",
      );
    if (security === "mfa-disabled")
      setSecurityNotice("MFA is disabled. Sign in again to continue.");
  }, []);

  useEffect(() => {
    if (phase === "totp") document.getElementById("login-totp")?.focus();
    else if (returnToUsername.current) {
      document.getElementById("login-id")?.focus();
      returnToUsername.current = false;
    }
  }, [phase]);
  useEffect(() => {
    if (error) errorRegion.current?.focus();
  }, [error]);

  function changeAccount() {
    returnToUsername.current = true;
    setPhase("credentials");
    setTotp("");
    setSecret("");
    setShowPassword(false);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setShowPassword(false);
    try {
      await api.login({
        loginId,
        secret,
        ...(totp ? { totp } : {}),
      });
      setSecret("");
      setTotp("");
      window.location.assign("/");
    } catch (err) {
      if (err instanceof ApiError && err.kind === "mfa-required") {
        if (phase === "credentials") setPhase("totp");
        else {
          setTotp("");
          setError({
            message:
              "That code could not be verified. Enter the current code from your authenticator app.",
          });
        }
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        setPhase("credentials");
        setSecret("");
        setTotp("");
      }
      setError({
        message:
          err instanceof ApiError
            ? err.message
            : "Sign-in failed. Please try again.",
        ...(err instanceof ApiError && err.correlationId
          ? { correlationId: err.correlationId }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-story auth-story--portrait" aria-label="Pulse connected care">
        <div className="auth-story__portrait">
          <div className="auth-story__halo" aria-hidden="true" />
          <img
            src="/assets/login-clinician.png"
            alt="A clinician in blue scrubs holding a stethoscope"
            width={1024}
            height={1536}
          />
          <div className="auth-story__caption">
            <span className="auth-story__caption-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                <path d="M3 12h4l3-7 4 14 3-7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span><strong>Connected care.</strong><small>Healthier communities.</small></span>
          </div>
        </div>
        <p className="auth-story__footer">
          People at the heart of every connection.
        </p>
      </section>

      <section className="auth-entry auth-entry--signin" aria-labelledby="login-heading">
        <div className="auth-entry__group">
          <img
            className="auth-logo"
            src="/brand/logo-tagline.png"
            alt="Pulse — Connected Care. Healthier Communities."
            width={216}
            height={72}
          />
          <div className="auth-entry__body">
          <div className="auth-heading">
            <h1 id="login-heading">
              {phase === "totp" ? "Verify your identity" : "Welcome back"}
            </h1>
            <p id="login-description">
              {phase === "totp"
                ? "Enter the 6-digit code from your authenticator app."
                : "Sign in to your Pulse staff workspace."}
            </p>
          </div>
          {phase === "totp" ? (
            <div className="auth-account">
              <span>
                Signing in as <strong>{loginId}</strong>
              </span>
              <button
                type="button"
                className="auth-text-button"
                disabled={busy || !ready}
                onClick={changeAccount}
              >
                Change account
              </button>
            </div>
          ) : null}
          {securityNotice ? (
            <Alert tone="success">{securityNotice}</Alert>
          ) : null}
          {error ? (
            <div ref={errorRegion} tabIndex={-1} className="auth-error">
              <Alert tone="error">
                {error.message}
                {error.correlationId ? (
                  <span className="auth-error__reference">
                    Reference: {error.correlationId}
                  </span>
                ) : null}
              </Alert>
            </div>
          ) : null}
          <form
            method="post"
            className="auth-form"
            onSubmit={submit}
            aria-describedby="login-description"
            aria-busy={busy}
          >
            {phase === "credentials" ? (
              <>
                <Input
                  label="Username"
                  id="login-id"
                  name="loginId"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Enter your username"
                  required
                  disabled={busy || !ready}
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                />
                <div className="auth-password">
                  <Input
                    label="Password"
                    id="login-secret"
                    name="secret"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Enter your password"
                    required
                    disabled={busy || !ready}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-password__toggle"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-controls="login-secret"
                    aria-pressed={showPassword}
                    disabled={busy || !ready}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </>
            ) : (
              <Input
                label="Authenticator code"
                id="login-totp"
                name="totp"
                className="auth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                aria-describedby="login-description"
                required
                disabled={busy || !ready}
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            )}
            <Button
              type="submit"
              className="auth-submit"
              loading={busy}
              disabled={busy || !ready}
            >
              {phase === "totp" ? "Verify and continue" : "Sign in"}
              <svg
                aria-hidden="true"
                focusable="false"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12h14m-6-6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
            {phase === "credentials" ? (
              <a className="auth-forgot" href="/forgot-password">Forgot password?</a>
            ) : null}
          </form>
          <details className="auth-help">
            <summary>
              {phase === "totp"
                ? "Having trouble with your code?"
                : "Need help signing in?"}
            </summary>
            <p>
              {phase === "totp"
                ? "Use the latest code and check that your device time is correct. If you no longer have access to your authenticator, contact your facility’s Pulse administrator."
                : "Contact your facility’s Pulse administrator to request account access, unlock your account or reset your password."}
            </p>
            <p>Never share your password or authenticator code.</p>
          </details>
        </div>
        </div>
        <p className="auth-entry__footer">
          <svg
            aria-hidden="true"
            focusable="false"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
          >
            <rect
              x="5"
              y="10"
              width="14"
              height="11"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 10V7a4 4 0 0 1 8 0v3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          For authorized staff. Access is monitored and audited.
        </p>
      </section>
    </main>
  );
}
