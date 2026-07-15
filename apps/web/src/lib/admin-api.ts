import { AuthRole, AuthUser, normalizeAuthUser, requestJson } from "./auth-api";

function authorizationHeader(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export interface AdminUserPage {
  items: AuthUser[];
  total: number;
  activeCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listAdminUsers(
  accessToken: string,
  query: { page: number; pageSize: number; search: string },
): Promise<AdminUserPage> {
  const searchParams = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.search.trim()) {
    searchParams.set("search", query.search.trim());
  }

  const response = await requestJson<AdminUserPage | AuthUser[]>(
    `/users?${searchParams.toString()}`,
    {
      headers: authorizationHeader(accessToken),
    },
  );

  if (Array.isArray(response)) {
    const normalizedSearch = query.search.trim().toLocaleLowerCase();
    const matchingUsers = response.map(normalizeAuthUser).filter((user) => {
      if (!normalizedSearch) {
        return true;
      }

      return [user.nickname, user.username].some((value) =>
        value.toLocaleLowerCase().includes(normalizedSearch),
      );
    });
    const totalPages = Math.max(
      1,
      Math.ceil(matchingUsers.length / query.pageSize),
    );
    const page = Math.min(query.page, totalPages);
    const start = (page - 1) * query.pageSize;

    return {
      items: matchingUsers.slice(start, start + query.pageSize),
      total: matchingUsers.length,
      activeCount: matchingUsers.filter((user) => user.status === "active")
        .length,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  return {
    ...response,
    items: response.items.map(normalizeAuthUser),
  };
}

export async function listRoles(): Promise<AuthRole[]> {
  return requestJson<AuthRole[]>("/roles");
}

export async function updateUserRole(
  accessToken: string,
  userId: number,
  roleCode: string,
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>(`/users/${userId}/role`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ roleCode }),
  });

  return normalizeAuthUser(user);
}

export async function updateUserStatus(
  accessToken: string,
  userId: number,
  status: AuthUser["status"],
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>(`/users/${userId}/status`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ status }),
  });

  return normalizeAuthUser(user);
}

export async function updateUserPassword(
  accessToken: string,
  userId: number,
  password: string,
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>(`/users/${userId}/password`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ password }),
  });

  return normalizeAuthUser(user);
}

export async function resetUserNickname(
  accessToken: string,
  userId: number,
): Promise<AuthUser> {
  const user = await requestJson<AuthUser>(`/users/${userId}/nickname/reset`, {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
  });

  return normalizeAuthUser(user);
}
