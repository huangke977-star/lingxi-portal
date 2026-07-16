import { AuthenticatedUser } from './auth.types';

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.isSuperAdmin;
}

export function hasRoleLevel(user: AuthenticatedUser, minLevel: number): boolean {
  return isSuperAdmin(user) || user.role.level >= minLevel;
}

export function canViewServerEntries(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}

export function canManageServerEntries(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}
