"use client";

import { BellRing, CalendarDays, Eye } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { ArticleBody } from "@/components/article-ui";
import { AnnouncementDetail, getAnnouncement } from "@/lib/announcements-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(null);
  const [token, setToken] = useState<string | null>(() => readAccessToken());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const id = Number(params.id);
    getAnnouncement(id, token)
      .then(setAnnouncement)
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          setToken(null);
          void getAnnouncement(id).then(setAnnouncement).catch((fallbackError) => setError(fallbackError instanceof Error ? fallbackError.message : "公告读取失败。"));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "公告读取失败。");
      });
  }, [params.id, token]);
  return <section className="page-shell announcement-detail-page">{announcement ? <article>
    <header><span><BellRing aria-hidden="true" size={18} />站点公告</span><h1>{announcement.title}</h1>{announcement.summary ? <p>{announcement.summary}</p> : null}<div><span><CalendarDays aria-hidden="true" size={13} />{formatTime(announcement.publishedAt ?? announcement.updatedAt)}</span><span><Eye aria-hidden="true" size={13} />{announcement.viewCount} 次阅读</span></div></header>
    <ArticleBody content={announcement.content} />
  </article> : <div className="article-empty-state">正在读取公告。</div>}<AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
