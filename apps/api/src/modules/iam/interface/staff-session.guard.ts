import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AccountSecurityService } from '../application/account-security.service.js';
@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(private readonly security: AccountSecurityService) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    await this.security.credential(request.headers.authorization);
    return true;
  }
}
