import { Module } from '@nestjs/common';
import { AccountSecurityService } from './application/account-security.service.js';
import { AccountSecurityController } from './interface/account-security.controller.js';
import { StaffSessionGuard } from './interface/staff-session.guard.js';
import { ACCOUNT_SECURITY_REPOSITORY } from './domain/account-security.repository.js';
import { KyselyAccountSecurityRepository } from './infrastructure/kysely-account-security.repository.js';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { AccessPolicyService } from './application/access-policy.service.js';
import { BreakGlassService } from './application/break-glass.service.js';
import { MembershipService } from './application/membership.service.js';
import { StaffAuthService } from './application/staff-auth.service.js';
import { BREAK_GLASS_REPOSITORY } from './domain/break-glass.repository.js';
import { CARE_ASSIGNMENT_REPOSITORY } from './domain/care-assignment.repository.js';
import { MEMBERSHIP_REPOSITORY } from './domain/membership.repository.js';
import { KyselyBreakGlassRepository } from './infrastructure/kysely-break-glass.repository.js';
import { KyselyCareAssignmentRepository } from './infrastructure/kysely-care-assignment.repository.js';
import { KyselyMembershipRepository } from './infrastructure/kysely-membership.repository.js';
import { CREDENTIAL_REPOSITORY } from './domain/credential.repository.js';
import { KyselyCredentialRepository } from './infrastructure/kysely-credential.repository.js';
import { AuthorizationGuard } from './interface/authorization.guard.js';
import { StaffAuthController } from './interface/staff-auth.controller.js';
import { StaffContextService } from './application/staff-context.service.js';
import { STAFF_CONTEXT_REPOSITORY } from './domain/staff-context.repository.js';
import { KyselyStaffContextRepository } from './infrastructure/kysely-staff-context.repository.js';

@Module({
  imports: [OutboxModule],
  providers: [
    AccountSecurityService,
    StaffSessionGuard,
    { provide: ACCOUNT_SECURITY_REPOSITORY, useClass: KyselyAccountSecurityRepository },
    AccessPolicyService,
    BreakGlassService,
    MembershipService,
    StaffAuthService,
    StaffContextService,
    { provide: STAFF_CONTEXT_REPOSITORY, useClass: KyselyStaffContextRepository },
    AuthorizationGuard,
    {
      provide: MEMBERSHIP_REPOSITORY,
      useClass: KyselyMembershipRepository,
    },
    {
      provide: CREDENTIAL_REPOSITORY,
      useClass: KyselyCredentialRepository,
    },
    {
      provide: CARE_ASSIGNMENT_REPOSITORY,
      useClass: KyselyCareAssignmentRepository,
    },
    {
      provide: BREAK_GLASS_REPOSITORY,
      useClass: KyselyBreakGlassRepository,
    },
  ],
  controllers: [StaffAuthController, AccountSecurityController],
  exports: [
    StaffContextService,
    CREDENTIAL_REPOSITORY,
    CARE_ASSIGNMENT_REPOSITORY,
    BREAK_GLASS_REPOSITORY,
    AccessPolicyService,
    BreakGlassService,
    MembershipService,
    StaffAuthService,
    AuthorizationGuard,
  ],
})
export class IamModule {}
