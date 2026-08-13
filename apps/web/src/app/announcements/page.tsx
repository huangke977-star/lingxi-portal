"use client";

import { Bell, CalendarDays, Eye, Pin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AnnouncementPage, listAnnouncements } from "@/lib/announcements-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function AnnouncementsPage() {
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
        setError(loadError instanceof Error ? loadError.message : "公告读取失败。");
      });
  }, [page]);
  return <section className="page-shell announcement-page">
    <div className="announcement-toolbar"><div><h1>站点公告</h1><p>查看站点更新、服务通知和面向当前角色发布的内容。</p></div>{data ? <span>{data.total} 条</span> : null}</div>
    <div className="announcement-list">{data?.items.map((item) => <Link className={item.unread ? "unread" : undefined} href={`/announcements/${item.id}`} key={item.id}>{item.isPinned ? <Pin aria-hidden="true" className="announcement-pin" size={15} /> : <Bell aria-hidden="true" size={17} />}<span><strong>{item.title}</strong><small>{item.summary || "打开查看公告详情"}</small><i><span><CalendarDays aria-hidden="true" size={12} />{formatTime(item.publishedAt ?? item.updatedAt)}</span><span><Eye aria-hidden="true" size={12} />{item.viewCount}</span></i></span>{item.unread ? <b>未读</b> : null}</Link>)}</div>
    {!data ? <div className="article-empty-state">正在读取公告。</div> : !data.items.length ? <div className="article-empty-state">当前没有可见公告。</div> : null}
    {data && data.totalPages > 1 ? <nav className="admin-pagination" aria-label="公告分页"><span>第 {data.page} / {data.totalPages} 页</span><div><button disabled={data.page <= 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button><button disabled={data.page >= data.totalPages} onClick={() => setPage((current) => current + 1)} type="button">下一页</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
