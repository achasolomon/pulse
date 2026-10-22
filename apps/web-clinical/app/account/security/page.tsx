import { redirect } from "next/navigation";
import type { StaffAccountSecurity } from "@pulse/api-client";
import { validatedSession } from "../../../lib/session.js";
import { serverApi } from "../../../lib/api.js";
import { Shell } from "../../../components/shell.js";
import { AccountSecurity } from "../../../components/account-security.js";
export default async function AccountSecurityPage() {
  const session = await validatedSession();
  if (!session) redirect("/login");
  const status = await serverApi(
    session.session.token,
  ).request<StaffAccountSecurity>("/iam/auth/account/security");
  return (
    <Shell session={session.publicSession}>
      <div className="page-head">
        <div className="page-greeting">
          <h1>Personal settings</h1>
          <p>Manage how you sign in and recover your account.</p>
        </div>
      </div>
      <AccountSecurity
        status={status}
        loginId={session.publicSession.loginId}
      />
    </Shell>
  );
}
