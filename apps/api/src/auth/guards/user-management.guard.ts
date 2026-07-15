import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth.types';
import { hasRoleLevel } from '../permissions';

@Injectable()
export class UserManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user || !hasRoleLevel(request.user, 90)) {
      throw new ForbiddenException('Administrator permission is required.');
    }

    return true;
  }
}
