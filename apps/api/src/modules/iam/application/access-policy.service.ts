import { Injectable } from '@nestjs/common';
import { evaluateAccess } from '../domain/policy.js';
import type { AccessDecision, AccessRequest } from '../domain/types.js';

@Injectable()
export class AccessPolicyService {
  evaluate(req: AccessRequest): AccessDecision {
    return evaluateAccess(req);
  }
}
