import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth.types';
import { isSiteManager } from '../permissions';

@Injectable()
export class UserManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user || !isSiteManager(request.user)) {
      throw new ForbiddenException('Administrator permission is required.');
    }

    return true;
  }
}
