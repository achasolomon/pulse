import { SetMetadata } from '@nestjs/common';
import { REQUIRE_PRIVILEGE_KEY } from './authorization.guard.js';
import type { RequirePrivilegeOptions } from './authorization.guard.js';

export const RequirePrivilege = (options: RequirePrivilegeOptions) =>
  SetMetadata(REQUIRE_PRIVILEGE_KEY, options);
