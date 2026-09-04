"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Coins,
  Database,
  FileText,
  Flag,
  LayoutDashboard,
  Link2,
  Megaphone,
  MessageSquare,
  PackageOpen,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";

type AdminIcon = typeof UsersRound;

interface AdminEntry {
  description: [string, string];
  icon: AdminIcon;
  path: string;
  title: [string, string];
  superAdminOnly?: boolean;
}

const ADMIN_ENTRIES: AdminEntry[] = [
  { path: "/admin/users", icon: UsersRound, title: ["用户管理", "User management"], description: ["管理账号、角色和状态。", "Manage accounts, roles, and status."] },
  { path: "/admin/reports", icon: Flag, title: ["举报中心", "Report center"], description: ["处理文章、评论和群消息举报。", "Handle article, comment, and group reports."] },
  { path: "/admin/content", icon: FileText, title: ["内容管理", "Content management"], description: ["审核和维护站内内容。", "Review and maintain site content."] },
  { path: "/admin/violations", icon: AlertTriangle, title: ["违规作者", "Policy violations"], description: ["查看违规作者及相关记录。", "Review authors and policy violations."] },
  { path: "/admin/feedback", icon: MessageSquare, title: ["用户反馈管理", "Feedback management"], description: ["集中处理用户提交的反馈。", "Handle submitted user feedback."] },
  { path: "/admin/groups", icon: UsersRound, title: ["群聊管理", "Group management"], description: ["管理群聊和群聊举报。", "Manage groups and group reports."] },
  { path: "/admin/voices", icon: MessageSquare, title: ["匿名话题管理", "Anonymous topics"], description: ["维护匿名话题和互动内容。", "Maintain anonymous topics and discussions."] },
  { path: "/admin/analytics", icon: BarChart3, title: ["运营数据", "Analytics"], description: ["查看站点运营统计。", "Review site operations metrics."] },
  { path: "/admin/resources", icon: Coins, title: ["资源与积分", "Resources and points"], description: ["管理资源交付和积分账本。", "Manage resource delivery and the points ledger."] },
  { path: "/admin/announcements", icon: Megaphone, title: ["公告管理", "Announcements"], description: ["发布和管理站点公告。", "Publish and manage announcements."] },
  { path: "/admin/audit", icon: ScrollText, title: ["审计日志", "Audit log"], description: ["查看关键管理操作记录。", "Review important management actions."] },
  { path: "/admin/security", icon: ShieldCheck, title: ["安全管理", "Security"], description: ["管理站点安全配置。", "Manage site security settings."] },
  { path: "/admin/deleted-users", icon: UserRoundX, title: ["已注销账号", "Deleted accounts"], description: ["查看注销账号的内容归属。", "Review deleted-account ownership."] },
  { path: "/admin/integrations", icon: Link2, title: ["外部集成", "Integrations"], description: ["管理 Webhook 和只读接口。", "Manage webhooks and read-only access."], superAdminOnly: true },
  { path: "/admin/settings", icon: Settings2, title: ["站点设置", "Site settings"], description: ["配置站点基础信息和显示。", "Configure site identity and display."] , superAdminOnly: true },
  { path: "/admin/android", icon: PackageOpen, title: ["安装包管理", "Package management"], description: ["管理移动端安装包版本。", "Manage mobile package versions."], superAdminOnly: true },
  { path: "/admin/cache", icon: Database, title: ["缓存管理", "Cache management"], description: ["查看和维护站点缓存。", "Inspect and maintain site cache."], superAdminOnly: true },
  { path: "/admin/system", icon: Activity, title: ["系统概览", "System overview"], description: ["查看运行状态和系统资源。", "Review runtime status and resources."], superAdminOnly: true },
];

export default function AdminOverviewPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }

    let isMounted = true;
    void getMe(token)
      .then((user) => {
        if (isMounted) setCurrentUser(user);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        if (isMounted) setError(loadError instanceof Error ? loadError.message : phrase("无法读取管理权限。", "Could not read management permissions."));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [locale, phrase, router]);

  const description = phrase("按权限进入站点管理功能。", "Open site management tools based on your permissions.");

  if (isLoading) {
    return <AdminPageLoading description={description} loadingLabel={phrase("正在读取权限", "Checking access")} title={phrase("后台管理", "Admin")} />;
  }

  if (!currentUser || !isSiteManager(currentUser)) {
    return (
      <section className="page-shell admin-shell">
        <AdminPageHeader description={phrase("该页面仅站点管理员可访问。", "This page is available only to site administrators.")} title={phrase("无权访问", "Access denied")} />
        {error ? <AppToast message={error} onDismiss={() => setError("")} tone="error" /> : null}
      </section>
    );
  }

  const entries = ADMIN_ENTRIES.filter((entry) => !entry.superAdminOnly || currentUser.isSuperAdmin);

  return (
    <section className="page-shell admin-shell admin-overview-page">
      <AdminPageHeader description={description} title={phrase("后台管理", "Admin")} />
      <div className="admin-overview-grid">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link className="admin-overview-item" href={localizedPath(entry.path, locale)} key={entry.path}>
              <span className="admin-overview-item-icon"><Icon aria-hidden="true" size={18} /></span>
              <span className="admin-overview-item-copy"><strong>{phrase(...entry.title)}</strong><small>{phrase(...entry.description)}</small></span>
              <LayoutDashboard aria-hidden="true" className="admin-overview-item-arrow" size={14} />
            </Link>
          );
        })}
      </div>
      {error ? <AppToast message={error} onDismiss={() => setError("")} tone="error" /> : null}
    </section>
  );
}
