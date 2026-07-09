import { AuthRole, AuthUser, requestJson } from './auth-api';

function authorizationHeader(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function listAdminUsers(accessToken: string): Promise<AuthUser[]> {
  return requestJson<AuthUser[]>('/users', {
    headers: authorizationHeader(accessToken),
  });
}

export async function listRoles(): Promise<AuthRole[]> {
  return requestJson<AuthRole[]>('/roles');
}

export async function updateUserRole(accessToken: string, userId: number, roleCode: string): Promise<AuthUser> {
  return requestJson<AuthUser>(`/users/${userId}/role`, {
    method: 'PATCH',
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ roleCode }),
  });
}

export async function updateUserStatus(
  accessToken: string,
  userId: number,
  status: AuthUser['status'],
): Promise<AuthUser> {
  return requestJson<AuthUser>(`/users/${userId}/status`, {
    method: 'PATCH',
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ status }),
  });
}

export async function updateUserPassword(accessToken: string, userId: number, password: string): Promise<AuthUser> {
  return requestJson<AuthUser>(`/users/${userId}/password`, {
    method: 'PATCH',
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ password }),
  });
}
