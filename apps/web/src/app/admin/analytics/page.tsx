"use client";

import { Activity, Bookmark, Eye, FileText, Heart, MessageCircle, Rss, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AdminAnalytics, AnalyticsTrendPoint, getAdminAnalytics } from "@/lib/analytics-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

type Range = 7 | 30 | 90;
type SeriesKey = Exclude<keyof AnalyticsTrendPoint, "date">;

const metricConfig: Array<{ key: SeriesKey; label: string; icon: typeof Activity }> = [
  { key: "users", label: "新增用户", icon: Users },
  { key: "articles", label: "发布文章", icon: FileText },
  { key: "views", label: "阅读", icon: Eye },
  { key: "likes", label: "点赞", icon: Heart },
  { key: "favorites", label: "收藏", icon: Bookmark },
  { key: "comments", label: "评论", icon: MessageCircle },
  { key: "subscriptions", label: "订阅", icon: Rss },
];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>(30);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`/login?from=${encodeURIComponent("/admin/analytics")}`);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      Promise.all([getMe(token), getAdminAnalytics(token, range)])
      .then(([currentUser, next]) => {
        if (!active) return;
        if (!currentUser.isSuperAdmin && currentUser.role.level < 90) {
          setError("当前账号没有查看数据分析的权限。");
          setUser(currentUser);
          return;
        }
        setUser(currentUser);
        setData(next);
      })
      .catch((loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "数据分析加载失败。");
      })
      .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [range, router]);

  if (!isLoading && user && !user.isSuperAdmin && user.role.level < 90) {
    return <section className="page-shell analytics-page"><div className="search-page-empty"><strong>无法进入数据分析</strong><span>{error}</span></div></section>;
  }

  return <section className="page-shell analytics-page">
    <header className="analytics-toolbar"><div><span>Content Insights</span><h1>内容数据分析</h1><p>统计范围内的用户增长、文章发布和互动变化。</p></div><div className="analytics-range" role="group" aria-label="统计范围">{([7, 30, 90] as const).map((value) => <button className={range === value ? "active" : undefined} key={value} onClick={() => setRange(value)} type="button">{value} 天</button>)}</div></header>
    {isLoading ? <div className="article-empty-state">正在计算趋势数据。</div> : data ? <>
      <div className="analytics-metrics">{metricConfig.map(({ key, label, icon: Icon }) => <article key={key}><Icon aria-hidden="true" size={18} /><span><small>{label}</small><strong>{data.summary[key].toLocaleString("zh-CN")}</strong></span></article>)}</div>
      <div className="analytics-charts"><TrendChart data={data.trend} series={[{ key: "users", label: "新增用户", color: "#4b78d1" }, { key: "articles", label: "发布文章", color: "#a46cbd" }, { key: "views", label: "阅读", color: "#2f9378" }]} title="增长与内容" /><TrendChart data={data.trend} series={[{ key: "likes", label: "点赞", color: "#d15f79" }, { key: "favorites", label: "收藏", color: "#b78331" }, { key: "comments", label: "评论", color: "#4f86a8" }, { key: "subscriptions", label: "订阅", color: "#7359a8" }]} title="互动趋势" /></div>
      <span className="analytics-generated">数据生成于 {new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}，结果缓存 5 分钟。</span>
    </> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function TrendChart({ data, series, title }: { data: AnalyticsTrendPoint[]; series: Array<{ key: SeriesKey; label: string; color: string }>; title: string }) {
  const width = 760;
  const height = 260;
  const padding = { top: 24, right: 20, bottom: 34, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...data.flatMap((point) => series.map(({ key }) => point[key])));
  const x = (index: number) => padding.left + (data.length <= 1 ? 0 : index / (data.length - 1)) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const labelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return <section className="analytics-chart"><header><strong>{title}</strong><span>{series.map((item) => <i key={item.key}><b style={{ background: item.color }} />{item.label}</i>)}</span></header><div className="analytics-chart-canvas"><svg aria-label={`${title}折线图`} role="img" viewBox={`0 0 ${width} ${height}`}><line className="analytics-axis" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} />{[0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line className="analytics-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * (1 - ratio)} y2={padding.top + plotHeight * (1 - ratio)} /><text className="analytics-y-label" x={padding.left - 7} y={padding.top + plotHeight * (1 - ratio) + 4}>{Math.round(maxValue * ratio)}</text></g>)}{series.map((item) => <g key={item.key}><polyline fill="none" points={data.map((point, index) => `${x(index)},${y(point[item.key])}`).join(" ")} stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />{data.map((point, index) => <circle cx={x(index)} cy={y(point[item.key])} fill={item.color} key={`${item.key}-${point.date}`} r="2.6"><title>{point.date} {item.label} {point[item.key]}</title></circle>)}</g>)}{data.map((point, index) => labelIndexes.has(index) ? <text className="analytics-x-label" key={point.date} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} x={x(index)} y={height - 10}>{point.date.slice(5)}</text> : null)}</svg></div></section>;
}
