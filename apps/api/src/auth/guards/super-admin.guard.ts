import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth.types';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user?.isSuperAdmin) {
      throw new ForbiddenException('Super admin permission is required.');
    }

    return true;
  }
}
