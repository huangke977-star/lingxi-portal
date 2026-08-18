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

export function UserIdentityBadges({
  user,
  className = "",
}: {
  user: IdentityBadgeUser;
  className?: string;
}) {
  const management = getManagementIdentity(user);

  return (
    <span className={`user-identity-badges ${className}`.trim()}>
      {management ? (
        <span
          className="user-identity-badge management"
          data-role={management.code}
          title={management.label}
        >
          <RoleSymbol code={management.code} />
        </span>
      ) : null}
      <span
        className="user-identity-badge growth"
        data-role={user.role.code}
        title={`成长等级：${user.role.name}`}
      >
        <RoleSymbol code={user.role.code} />
      </span>
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
