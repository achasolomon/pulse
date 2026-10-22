import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import nodemailer from 'nodemailer';
import {
  CREDENTIAL_REPOSITORY,
  type CredentialRepository,
} from '../domain/credential.repository.js';
import {
  ACCOUNT_SECURITY_REPOSITORY,
  type AccountSecurityRepository,
} from '../domain/account-security.repository.js';
import { hashSecret, hashToken, verifySecret } from '../domain/credentials.js';
import { verifyTotp } from '../domain/totp.js';
import { StaffAuthService } from './staff-auth.service.js';

@Injectable()
export class AccountSecurityService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private delivering = false;
  private readonly logger = new Logger(AccountSecurityService.name);
  constructor(
    @Inject(CREDENTIAL_REPOSITORY)
    private readonly credentials: CredentialRepository,
    @Inject(ACCOUNT_SECURITY_REPOSITORY)
    private readonly accounts: AccountSecurityRepository,
    private readonly auth: StaffAuthService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.deliverMail();
    }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private mailConfig() {
    const secret = process.env.STAFF_RECOVERY_MAIL_KEY;
    const host = process.env.SMTP_HOST;
    const origin = process.env.STAFF_WEB_ORIGIN;
    if (
      !secret ||
      secret.length < 32 ||
      !host ||
      !origin ||
      !process.env.SMTP_FROM
    )
      throw new ServiceUnavailableException({
        code: 'RECOVERY_UNAVAILABLE',
        message: 'Account recovery is temporarily unavailable',
      });
    const url = new URL(origin);
    if (
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          url.protocol === 'http:'
        ))
    )
      throw new ServiceUnavailableException('Invalid recovery origin');
    return {
      key: createHash('sha256').update(secret).digest(),
      host,
      origin: url.origin,
    };
  }
  private encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.mailConfig().key, iv);
    cipher.setAAD(Buffer.from('pulse.recovery-mail.v1'));
    return Buffer.concat([
      iv,
      cipher.update(token),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  }
  private decrypt(value: string) {
    const bytes = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      this.mailConfig().key,
      bytes.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from('pulse.recovery-mail.v1'));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      cipher.update(bytes.subarray(12, -16)),
      cipher.final(),
    ]).toString();
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async credential(authorization?: string) {
    if (!authorization || !/^Bearer staff_[a-f0-9]{64}$/.test(authorization))
      throw new UnauthorizedException('Please sign in again');
    const s = await this.credentials.findSession(
      hashToken(authorization.slice(7)),
    );
    const c = s ? await this.credentials.findById(s.credentialId) : undefined;
    if (
      !s ||
      s.expiresAt.getTime() <= Date.now() ||
      !c?.personId ||
      c.status !== 'active' ||
      s.personId !== c.personId
    )
      throw new UnauthorizedException('Please sign in again');
    return c;
  }
  async status(authorization?: string) {
    const c = await this.credential(authorization);
    return this.accounts.status(c.id);
  }
  async requestReset(loginId: string) {
    const started = Date.now();
    this.mailConfig();
    const c = await this.accounts.findRecoveryCredential(loginId.trim());
    if (c) await this.issue(c.id, c.email, 'password_reset');
    // SMTP delivery runs independently; apply the same minimum response time
    // to known/unknown accounts rather than leaking an inbox lookup in the UI.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))),
    );
    return { accepted: true };
  }
  async requestEmail(
    authorization: string | undefined,
    email: string,
    secret: string,
    totp?: string,
  ) {
    this.mailConfig();
    const c = await this.credential(authorization);
    this.reauthenticate(c, secret, totp);
    await this.issue(c.id, email.trim().toLowerCase(), 'verify_email');
    return { accepted: true };
  }
  private async issue(
    credentialId: string,
    email: string,
    purpose: 'password_reset' | 'verify_email',
  ) {
    const token = randomBytes(32).toString('base64url');
    await this.accounts.createRequest({
      id: randomUUID(),
      credentialId,
      email,
      purpose,
      tokenHash: this.digest(token),
      encryptedToken: this.encrypt(token),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    });
  }
  async finishReset(token: string, secret: string) {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !(await this.accounts.resetPassword(
        this.digest(token),
        hashSecret(secret),
      ))
    )
      throw new BadRequestException({
        code: 'RECOVERY_LINK_INVALID',
        message: 'This recovery link is invalid or has expired',
      });
    return { changed: true };
  }
  async verifyEmail(authorization: string | undefined, token: string) {
    const c = await this.credential(authorization);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !(await this.accounts.verifyEmail(this.digest(token), c.id))
    )
      throw new BadRequestException({
        code: 'RECOVERY_LINK_INVALID',
        message: 'This verification link is invalid or has expired',
      });
    return { verified: true };
  }
  private reauthenticate(
    c: Awaited<ReturnType<AccountSecurityService['credential']>>,
    secret: string,
    totp?: string,
  ) {
    if (
      !verifySecret(secret, c.secretHash) ||
      (c.totpEnabled &&
        (!c.totpSecret || !totp || !verifyTotp(c.totpSecret, totp)))
    )
      throw new BadRequestException({
        code: 'STAFF_REAUTH_FAILED',
        message: 'Verify your password and authenticator code to continue',
      });
  }
  async enroll(authorization: string | undefined, secret: string) {
    const c = await this.credential(authorization);
    if (c.totpEnabled) throw new BadRequestException('MFA is already enabled');
    this.reauthenticate(c, secret);
    return this.auth.enrollTotp(c.id);
  }
  async confirm(authorization: string | undefined, code: string) {
    const c = await this.credential(authorization);
    if (c.totpEnabled) throw new BadRequestException('MFA is already enabled');
    if (
      !c.totpSecret ||
      !verifyTotp(c.totpSecret, code) ||
      !(await this.accounts.setMfaAndRevoke(c.id, c.totpSecret, true))
    )
      throw new BadRequestException(
        'The authenticator code could not be verified',
      );
    return { enabled: true };
  }
  async disable(
    authorization: string | undefined,
    secret: string,
    totp: string,
  ) {
    const c = await this.credential(authorization);
    if (!c.totpEnabled) throw new BadRequestException('MFA is not enabled');
    this.reauthenticate(c, secret, totp);
    if (
      !c.totpSecret ||
      !(await this.accounts.setMfaAndRevoke(c.id, c.totpSecret, false))
    )
      throw new BadRequestException(
        'Account security settings changed. Please retry.',
      );
    return { enabled: false };
  }
  async deliverMail() {
    if (
      this.delivering ||
      !process.env.DATABASE_URL ||
      !process.env.SMTP_HOST ||
      !process.env.STAFF_RECOVERY_MAIL_KEY
    )
      return;
    this.delivering = true;
    try {
      const config = this.mailConfig();
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        requireTLS: process.env.NODE_ENV === 'production',
        connectionTimeout: 5000,
        socketTimeout: 10000,
        ...(process.env.SMTP_USER
          ? {
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS ?? '',
              },
            }
          : {}),
      });
      for (const job of await this.accounts.pendingMail()) {
        const token = this.decrypt(job.encryptedToken);
        const path =
          job.purpose === 'password_reset'
            ? '/reset-password'
            : '/verify-email';
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: job.email,
          subject:
            job.purpose === 'password_reset'
              ? 'Reset your Pulse password'
              : 'Verify your Pulse recovery email',
          text: `Open this link to ${job.purpose === 'password_reset' ? 'reset your password' : 'verify your recovery email'}:\n${config.origin}${path}#token=${token}\n\nThis link expires in 20 minutes and can be used once. If you did not request it, ignore this email.`,
        });
        await this.accounts.markDelivered(job.id);
      }
    } catch {
      this.logger.warn(
        'Recovery email delivery unavailable; pending requests will be retried.',
      );
    } finally {
      this.delivering = false;
    }
  }
}
