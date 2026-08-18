import { RoleSymbol } from "@/components/role-symbol";
import { getManagementIdentity } from "@/lib/user-permissions";

export interface IdentityBadgeUser {
  isSuperAdmin: boolean;
  isAdministrator?: boolean;
  role: {
    code: string;
    name: string;
  };
}

export function AvatarManagementBadge({
  user,
  className = "",
}: {
  user: IdentityBadgeUser;
  className?: string;
}) {
  const management = getManagementIdentity(user);
  if (!management) return null;

  return (
    <span
      className={`avatar-management-badge ${className}`.trim()}
      data-role={management.code}
      title={management.label}
    >
      <RoleSymbol code={management.code} />
    </span>
  );
}

export function ManagementIdentitySymbol({
  user,
  className = "",
}: {
  user: Pick<IdentityBadgeUser, "isSuperAdmin" | "isAdministrator">;
  className?: string;
}) {
  const management = getManagementIdentity(user);
  if (!management) return null;

  return (
    <span
      className={`management-identity-symbol ${className}`.trim()}
      data-role={management.code}
      title={management.label}
    >
      <RoleSymbol code={management.code} />
    </span>
  );
}
