import { Module } from '@nestjs/common';
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

@Module({
  imports: [OutboxModule],
  providers: [
    AccessPolicyService,
    BreakGlassService,
    MembershipService,
    StaffAuthService,
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
  controllers: [StaffAuthController],
  exports: [
    AccessPolicyService,
    BreakGlassService,
    MembershipService,
    StaffAuthService,
    AuthorizationGuard,
  ],
})
export class IamModule {}
