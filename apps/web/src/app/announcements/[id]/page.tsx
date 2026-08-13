"use client";

import { BellRing, CalendarDays, Check, Eye } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { ArticleBody } from "@/components/article-ui";
import { AnnouncementDetail, confirmAnnouncement, getAnnouncement } from "@/lib/announcements-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { notifySocialStateChange } from "@/lib/social-events";

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(null);
  const [token, setToken] = useState<string | null>(() => readAccessToken());
  const [isConfirming, setIsConfirming] = useState(false);
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
  async function confirm() {
    if (!token || !announcement || isConfirming) return;
    setIsConfirming(true);
    try {
      const result = await confirmAnnouncement(token, announcement.id);
      setAnnouncement({ ...announcement, confirmedAt: result.confirmedAt, unread: false });
      setNotice("已确认阅读这条公告。");
      notifySocialStateChange();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "已读确认失败。");
    } finally {
      setIsConfirming(false);
    }
  }
  return <section className="page-shell announcement-detail-page">{announcement ? <article>
    <header><span><BellRing aria-hidden="true" size={18} />站点公告</span><h1>{announcement.title}</h1>{announcement.summary ? <p>{announcement.summary}</p> : null}<div><span><CalendarDays aria-hidden="true" size={13} />{formatTime(announcement.publishedAt ?? announcement.updatedAt)}</span><span><Eye aria-hidden="true" size={13} />{announcement.viewCount} 次阅读</span></div></header>
    <ArticleBody content={announcement.content} />
    {token ? <footer><button className={announcement.confirmedAt ? "confirmed" : undefined} disabled={Boolean(announcement.confirmedAt) || isConfirming} onClick={() => void confirm()} type="button"><Check aria-hidden="true" size={16} />{announcement.confirmedAt ? `已于 ${formatTime(announcement.confirmedAt)} 确认` : isConfirming ? "确认中" : "确认已读"}</button></footer> : null}
  </article> : <div className="article-empty-state">正在读取公告。</div>}<AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
