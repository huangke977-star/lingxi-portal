import { AuthenticatedUser } from './auth.types';

export function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.isSuperAdmin;
}

export function isAdministrator(user: AuthenticatedUser): boolean {
  return Boolean(user.isAdministrator);
}

export function isSiteManager(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user) || isAdministrator(user);
}

export function canViewServerEntries(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}

export function canManageServerEntries(user: AuthenticatedUser): boolean {
  return isSuperAdmin(user);
}
