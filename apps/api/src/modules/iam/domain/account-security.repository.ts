export const ACCOUNT_SECURITY_REPOSITORY = 'ACCOUNT_SECURITY_REPOSITORY';
export interface RecoveryJob {
  id: string;
  credentialId: string;
  purpose: 'password_reset' | 'verify_email';
  email: string;
  encryptedToken: string;
}
export interface AccountSecurityRepository {
  status(
    credentialId: string,
  ): Promise<{
    mfaEnabled: boolean;
    recoveryEmail: string | null;
    emailVerified: boolean;
  }>;
  findRecoveryCredential(
    loginId: string,
  ): Promise<{ id: string; email: string } | undefined>;
  createRequest(
    input: RecoveryJob & { tokenHash: string; expiresAt: Date },
  ): Promise<void>;
  pendingMail(): Promise<RecoveryJob[]>;
  markDelivered(id: string): Promise<void>;
  resetPassword(tokenHash: string, secretHash: string): Promise<boolean>;
  verifyEmail(tokenHash: string, credentialId: string): Promise<boolean>;
  setMfaAndRevoke(
    credentialId: string,
    expectedSecret: string,
    enabled: boolean,
  ): Promise<boolean>;
}
