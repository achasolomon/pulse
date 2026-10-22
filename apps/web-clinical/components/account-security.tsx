"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Input } from "@pulse/ui";
import { SettingsDrawer } from "./settings-drawer.js";
import {
  ApiError,
  createStaffWebApi,
  type StaffAccountSecurity,
} from "@pulse/api-client";
const api = createStaffWebApi();
export function AccountSecurity({
  status,
  loginId,
}: {
  status: StaffAccountSecurity;
  loginId: string;
}) {
  const [editing, setEditing] = useState<"mfa" | "email" | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [secret, setSecret] = useState("");
  const [totp, setTotp] = useState("");
  const [email, setEmail] = useState(status.recoveryEmail ?? "");
  const [emailSecret, setEmailSecret] = useState("");
  const [emailTotp, setEmailTotp] = useState("");
  const [setup, setSetup] = useState<{ uri: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (error || notice) feedback.current?.focus();
  }, [error, notice]);
  useEffect(() => {
    if (editing)
      document
        .getElementById(editing === "mfa" ? "mfa-password" : "recovery-email")
        ?.focus();
  }, [editing]);
  function close() {
    const previous = editing;
    setEditing(null);
    setSetup(null);
    setSecret("");
    setTotp("");
    setEmailSecret("");
    setEmailTotp("");
    setError(null);
    setNotice(null);
    document
      .getElementById(previous === "mfa" ? "manage-mfa" : "manage-email")
      ?.focus();
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update account security. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="personal-settings">
      <aside
        className="settings-navigation"
        aria-label="Personal settings sections"
      >
        <span className="settings-navigation__label">YOUR ACCOUNT</span>
        <a href="/account/security" aria-current="page">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          </svg>
          Security & sign-in
        </a>
        <p>These settings apply to your account across your facilities.</p>
      </aside>
      <div className="account-security">
        <div className="settings-account">
          <span className="settings-account__avatar" aria-hidden="true">
            {loginId.charAt(0).toUpperCase()}
          </span>
          <div>
            <span className="settings-eyebrow">Signed in as</span>
            <strong>{loginId}</strong>
            <p>Your personal account</p>
          </div>
        </div>
        <div className="settings-intro">
          <h2>Security & sign-in</h2>
          <p>
            Keep your account protected and make sure you can recover access.
          </p>
        </div>
        <Card title="Two-step verification">
          <div className="settings-row">
            <div className="settings-row__description">
              <span
                className={`settings-status${status.mfaEnabled ? " settings-status--enabled" : ""}`}
              >
                {status.mfaEnabled ? "Enabled" : "Not enabled"}
              </span>
              <p className="security-description">
                {status.mfaEnabled
                  ? "MFA is enabled. Your authenticator code is required after your password when signing in."
                  : "Add a code from your authenticator app as a second step after your password."}
              </p>
            </div>
            <Button
              id="manage-mfa"
              type="button"
              variant="secondary"
              disabled={!ready || busy}
              aria-expanded={editing === "mfa"}
              aria-controls="mfa-settings"
              onClick={() => {
                if (editing === "mfa") close();
                else {
                  close();
                  setEditing("mfa");
                }
              }}
            >
              {editing === "mfa"
                ? "Cancel"
                : status.mfaEnabled
                  ? "Manage"
                  : "Set up"}
            </Button>
          </div>
          {editing === "mfa" ? (
            <SettingsDrawer
              id="mfa-settings"
              title={
                status.mfaEnabled
                  ? "Manage two-step verification"
                  : "Set up two-step verification"
              }
              description="Protect your sign-in with an authenticator app."
              busy={busy}
              onClose={close}
            >
              {error || notice ? (
                <div ref={feedback} tabIndex={-1} className="settings-feedback">
                  {error ? <Alert tone="error">{error}</Alert> : null}
                  {notice ? <Alert tone="success">{notice}</Alert> : null}
                </div>
              ) : null}
              <div className="settings-editor">
                {setup ? (
                  <form
                    method="post"
                    className="security-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await api.confirmMfa(totp);
                        window.location.assign("/login?security=mfa-enabled");
                      });
                    }}
                  >
                    <p>
                      Add a new account in your authenticator app using this
                      setup key:
                    </p>
                    <code className="security-setup-key">{setup.key}</code>
                    <a href={setup.uri}>Open authenticator app</a>
                    <p className="recovery-note">
                      Keep this key private. Setup is not active until you
                      verify a code.
                    </p>
                    <Input
                      label="Authenticator code"
                      id="setup-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      disabled={busy}
                      value={totp}
                      onChange={(event) => setTotp(event.target.value)}
                    />
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={!ready || busy}
                    >
                      Enable MFA
                    </Button>
                  </form>
                ) : (
                  <form
                    method="post"
                    className="security-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        if (status.mfaEnabled) {
                          await api.disableMfa(secret, totp);
                          window.location.assign(
                            "/login?security=mfa-disabled",
                          );
                        } else {
                          const result = await api.enrollMfa(secret);
                          setSetup({
                            uri: result.otpauthUrl,
                            key:
                              new URL(result.otpauthUrl).searchParams.get(
                                "secret",
                              ) ?? "",
                          });
                          setSecret("");
                          setTotp("");
                        }
                      });
                    }}
                  >
                    <Input
                      label="Current password"
                      id="mfa-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={busy}
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                    {status.mfaEnabled ? (
                      <Input
                        label="Current authenticator code"
                        id="disable-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={busy}
                        value={totp}
                        onChange={(event) => setTotp(event.target.value)}
                      />
                    ) : null}
                    <Button
                      type="submit"
                      variant={status.mfaEnabled ? "secondary" : "primary"}
                      loading={busy}
                      disabled={!ready || busy}
                    >
                      {status.mfaEnabled
                        ? "Disable MFA"
                        : "Set up authenticator"}
                    </Button>
                  </form>
                )}
                <p className="recovery-note">
                  Changing MFA signs out existing sessions. You will sign in
                  again using the new setting.
                </p>
              </div>
            </SettingsDrawer>
          ) : null}
        </Card>
        <Card title="Recovery email">
          <div className="settings-row">
            <div className="settings-row__description">
              <span
                className={`settings-status${status.emailVerified ? " settings-status--enabled" : ""}`}
              >
                {status.emailVerified ? "Verified" : "Not configured"}
              </span>
              <p className="security-description">
                {status.emailVerified
                  ? `Verified email: ${status.recoveryEmail}`
                  : "Add an email address to receive a reset link if you forget your password."}
              </p>
            </div>
            <Button
              id="manage-email"
              type="button"
              variant="secondary"
              disabled={!ready || busy}
              aria-expanded={editing === "email"}
              aria-controls="email-settings"
              onClick={() => {
                if (editing === "email") close();
                else {
                  close();
                  setEditing("email");
                }
              }}
            >
              {editing === "email"
                ? "Cancel"
                : status.emailVerified
                  ? "Change"
                  : "Add email"}
            </Button>
          </div>
          {editing === "email" ? (
            <SettingsDrawer
              id="email-settings"
              title={
                status.emailVerified
                  ? "Change recovery email"
                  : "Add recovery email"
              }
              description="Use an inbox you can access if you forget your password."
              busy={busy}
              onClose={close}
            >
              {error || notice ? (
                <div ref={feedback} tabIndex={-1} className="settings-feedback">
                  {error ? <Alert tone="error">{error}</Alert> : null}
                  {notice ? <Alert tone="success">{notice}</Alert> : null}
                </div>
              ) : null}
              <div className="settings-editor">
                <form
                  method="post"
                  className="security-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await api.requestRecoveryEmail(
                        email,
                        emailSecret,
                        emailTotp || undefined,
                      );
                      setEmailSecret("");
                      setEmailTotp("");
                      setNotice(
                        "Verification link requested. Check your inbox and open its link while signed in to this account.",
                      );
                    });
                  }}
                >
                  <Input
                    label="Recovery email"
                    id="recovery-email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={busy}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <Input
                    label="Current password"
                    id="email-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                    value={emailSecret}
                    onChange={(event) => setEmailSecret(event.target.value)}
                  />
                  {status.mfaEnabled ? (
                    <Input
                      label="Current authenticator code"
                      id="email-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      disabled={busy}
                      value={emailTotp}
                      onChange={(event) => setEmailTotp(event.target.value)}
                    />
                  ) : null}
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={busy}
                    disabled={!ready || busy}
                  >
                    Send verification email
                  </Button>
                </form>
                <p className="recovery-note">
                  Your email changes only after you open the verification link.
                </p>
              </div>
            </SettingsDrawer>
          ) : null}
        </Card>
        <div className="settings-footnote">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="5"
              y="10"
              width="14"
              height="11"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M8 10V7a4 4 0 0 1 8 0v3"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
          We ask for your current password before changing security settings.
        </div>
      </div>
    </div>
  );
}
