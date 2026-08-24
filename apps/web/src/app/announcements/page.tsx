"use client";

import { Bell, CalendarDays, Eye, Pin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { AnnouncementPage, listAnnouncements } from "@/lib/announcements-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { formatDate, localizedPath } from "@/lib/i18n";

export default function AnnouncementsPage() {
  const { locale, phrase } = useLanguage();
  const [data, setData] = useState<AnnouncementPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    listAnnouncements({ page, pageSize: 12 }, token)
      .then(setData)
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          return listAnnouncements({ page, pageSize: 12 }).then(setData);
        }
        setError(loadError instanceof Error ? loadError.message : phrase("公告读取失败。", "Could not load announcements."));
      });
  }, [page, phrase]);
  return <section className="page-shell announcement-page">
    <div className="announcement-toolbar"><div><h1>{phrase("站点公告", "Site announcements")}</h1><p>{phrase("查看站点更新、服务通知和面向当前角色发布的内容。", "Review site updates, service notices, and content for your role.")}</p></div>{data ? <span>{phrase(`${data.total} 条`, `${data.total} announcements`)}</span> : null}</div>
    <div className="announcement-list">{data?.items.map((item) => <Link className={item.unread ? "unread" : undefined} href={localizedPath(`/announcements/${item.id}`, locale)} key={item.id}>{item.isPinned ? <Pin aria-hidden="true" className="announcement-pin" size={15} /> : <Bell aria-hidden="true" size={17} />}<span><strong>{item.title}</strong><small>{item.summary || phrase("打开查看公告详情", "Open announcement details")}</small><i><span><CalendarDays aria-hidden="true" size={12} />{formatTime(item.publishedAt ?? item.updatedAt, locale)}</span><span><Eye aria-hidden="true" size={12} />{item.viewCount}</span></i></span>{item.unread ? <b>{phrase("未读", "Unread")}</b> : null}</Link>)}</div>
    {!data ? <div className="article-empty-state">{phrase("正在读取公告。", "Loading announcements.")}</div> : !data.items.length ? <div className="article-empty-state">{phrase("当前没有可见公告。", "There are no visible announcements.")}</div> : null}
    {data && data.totalPages > 1 ? <nav className="admin-pagination" aria-label={phrase("公告分页", "Announcement pages")}><span>{phrase(`第 ${data.page} / ${data.totalPages} 页`, `Page ${data.page} / ${data.totalPages}`)}</span><div><button disabled={data.page <= 1} onClick={() => setPage((current) => current - 1)} type="button">{phrase("上一页", "Previous")}</button><button disabled={data.page >= data.totalPages} onClick={() => setPage((current) => current + 1)} type="button">{phrase("下一页", "Next")}</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function formatTime(value: string, locale: "zh-CN" | "en-US"): string {
  return formatDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
