export interface ManagementIdentity {
  isSuperAdmin: boolean;
  isAdministrator?: boolean;
}

export function isSiteManager(user: ManagementIdentity | null | undefined): boolean {
  return Boolean(user && (user.isSuperAdmin || user.isAdministrator));
}

export function getManagementIdentity(user: ManagementIdentity): {
  code: "super_administrator" | "administrator";
  label: "超级管理员" | "站点管理员";
} | null {
  if (user.isSuperAdmin) {
    return { code: "super_administrator", label: "超级管理员" };
  }
  if (user.isAdministrator) {
    return { code: "administrator", label: "站点管理员" };
  }
  return null;
}
