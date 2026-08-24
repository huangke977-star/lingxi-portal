"use client";

import { BellRing, CalendarDays, Eye } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { ArticleBody } from "@/components/article-ui";
import { useLanguage } from "@/components/language-provider";
import { AnnouncementDetail, getAnnouncement } from "@/lib/announcements-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { formatDate } from "@/lib/i18n";

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const { locale, phrase } = useLanguage();
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
          void getAnnouncement(id).then(setAnnouncement).catch((fallbackError) => setError(fallbackError instanceof Error ? fallbackError.message : phrase("公告读取失败。", "Could not load the announcement.")));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("公告读取失败。", "Could not load the announcement."));
      });
  }, [params.id, phrase, token]);
  return <section className="page-shell announcement-detail-page">{announcement ? <article>
    <header><span><BellRing aria-hidden="true" size={18} />{phrase("站点公告", "Site announcement")}</span><h1>{announcement.title}</h1>{announcement.summary ? <p>{announcement.summary}</p> : null}<div><span><CalendarDays aria-hidden="true" size={13} />{formatDate(announcement.publishedAt ?? announcement.updatedAt, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span><span><Eye aria-hidden="true" size={13} />{phrase(`${announcement.viewCount} 次阅读`, `${announcement.viewCount} views`)}</span></div></header>
    <ArticleBody content={announcement.content} />
  </article> : <div className="article-empty-state">{phrase("正在读取公告。", "Loading announcement.")}</div>}<AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
