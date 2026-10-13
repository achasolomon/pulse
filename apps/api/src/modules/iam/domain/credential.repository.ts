export const CREDENTIAL_REPOSITORY = 'CREDENTIAL_REPOSITORY';

export interface StaffCredential {
  id: string;
  personId?: string;
  accountName?: string;
  loginId: string;
  secretHash: string;
  status: string;
  totpEnabled: boolean;
  totpSecret?: string;
}

export interface StaffSession {
  sessionId: string;
  credentialId: string;
  personId?: string;
  scopes: string[];
}

export interface CredentialRepository {
  create(input: {
    personId?: string;
    accountName?: string;
    loginId: string;
    secretHash: string;
  }): Promise<{ id: string }>;
  findByLogin(loginId: string): Promise<StaffCredential | undefined>;
  findById(id: string): Promise<StaffCredential | undefined>;
  setTotp(id: string, secret: string | undefined, enabled: boolean): Promise<void>;
  createSession(input: {
    credentialId: string;
    personId?: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  findSession(tokenHash: string): Promise<StaffSession | undefined>;
  revokeSession(id: string): Promise<void>;
  linkIdentity(input: { personId: string; provider: string; subject: string }): Promise<{ id: string }>;
  findIdentity(provider: string, subject: string): Promise<{ personId: string } | undefined>;
}
