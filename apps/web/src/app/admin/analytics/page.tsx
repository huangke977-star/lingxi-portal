"use client";

import {
  Activity,
  Ban,
  Bookmark,
  Eye,
  FileText,
  Flag,
  Heart,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Rss,
  ShieldAlert,
  ThumbsUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import {
  AdminAnalytics,
  AnalyticsRankingItem,
  AnalyticsTrendPoint,
  getAdminAnalytics,
  rebuildAdminAnalytics,
} from "@/lib/analytics-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

type Range = 7 | 30 | 90;
type SeriesKey = Exclude<keyof AnalyticsTrendPoint, "date">;

const metrics: Array<{ key: SeriesKey; label: string; icon: typeof Activity }> = [
  { key: "newUsers", label: "新增用户", icon: Users },
  { key: "activeUsers", label: "活跃用户", icon: Activity },
  { key: "articles", label: "发布文章", icon: FileText },
  { key: "comments", label: "评论", icon: MessageCircle },
  { key: "messages", label: "聊天消息", icon: MessageCircle },
  { key: "views", label: "文章阅读", icon: Eye },
  { key: "likes", label: "点赞", icon: Heart },
  { key: "favorites", label: "收藏", icon: Bookmark },
  { key: "subscriptions", label: "订阅增长", icon: Rss },
  { key: "reports", label: "举报", icon: Flag },
  { key: "disabledUsers", label: "停用账号", icon: Ban },
  { key: "loginRisks", label: "登录风险", icon: ShieldAlert },
  { key: "failedJobs", label: "异常任务", icon: ShieldAlert },
  { key: "anonymousTopics", label: "匿名话题", icon: MessagesSquare },
  { key: "anonymousMessages", label: "匿名发言", icon: MessageCircle },
  { key: "anonymousLikes", label: "点评获赞", icon: ThumbsUp },
  { key: "anonymousFavorites", label: "话题喜欢", icon: Heart },
];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [range, setRange] = useState<Range>(30);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (currentRange: Range) => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`/login?from=${encodeURIComponent("/admin/analytics")}`);
      return;
    }
    setIsLoading(true);
    try {
      const [currentUser, result] = await Promise.all([getMe(token), getAdminAnalytics(token, currentRange)]);
      if (!currentUser.isSuperAdmin && currentUser.role.level < 90) {
        setUser(currentUser);
        setError("当前账号没有查看运营数据的权限。");
        return;
      }
      setUser(currentUser);
      setData(result);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "运营数据加载失败。");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(range), 0);
    return () => window.clearTimeout(timer);
  }, [load, range]);

  async function rebuild() {
    const token = readAccessToken();
    if (!token || isRebuilding) return;
    setIsRebuilding(true);
    setError("");
    try {
      const result = await rebuildAdminAnalytics(token, range);
      await load(range);
      setNotice(result.days ? `最近 ${result.days} 天的运营数据已补算完成。` : "运营数据补算任务正在执行。 ");
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : "运营数据补算失败。");
    } finally {
      setIsRebuilding(false);
    }
  }

  if (!isLoading && user && !user.isSuperAdmin && user.role.level < 90) {
    return <section className="page-shell analytics-page"><div className="search-page-empty"><strong>无法进入运营分析</strong><span>{error}</span></div></section>;
  }

  return <section className="page-shell analytics-page">
    <div className="analytics-toolbar">
      <div><h1>运营数据</h1><p>按中国时区自然日聚合，页面只读取聚合结果。</p></div>
      <div className="analytics-toolbar-actions">
        <div className="analytics-range" role="group" aria-label="统计范围">{([7, 30, 90] as const).map((value) => <button className={range === value ? "active" : undefined} key={value} onClick={() => setRange(value)} type="button">{value} 天</button>)}</div>
        <button aria-label="重新补算运营数据" className="analytics-rebuild" disabled={isLoading || isRebuilding} onClick={() => void rebuild()} title={`补算最近 ${range} 天`} type="button">{isRebuilding ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <RefreshCw aria-hidden="true" size={16} />}</button>
      </div>
    </div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />正在读取聚合数据。</div> : data ? <>
      <div className="analytics-metrics">{metrics.map(({ key, label, icon: Icon }) => <article className={key === "failedJobs" || key === "loginRisks" || key === "reports" ? "warning" : undefined} key={key}><Icon aria-hidden="true" size={17} /><span><small>{label}</small><strong>{data.summary[key].toLocaleString("zh-CN")}</strong></span></article>)}</div>
      <div className="analytics-charts">
        <TrendChart data={data.trend} series={[{ key: "newUsers", label: "新增", color: "#4b78d1" }, { key: "activeUsers", label: "活跃", color: "#2f9378" }, { key: "articles", label: "文章", color: "#a46cbd" }]} title="用户与内容" />
        <TrendChart data={data.trend} series={[{ key: "comments", label: "评论", color: "#4f86a8" }, { key: "messages", label: "消息", color: "#7359a8" }, { key: "views", label: "阅读", color: "#2f9378" }]} title="访问与交流" />
        <TrendChart data={data.trend} series={[{ key: "reports", label: "举报", color: "#d15f79" }, { key: "loginRisks", label: "风险", color: "#c07b31" }, { key: "failedJobs", label: "异常任务", color: "#8d5961" }]} title="风险与异常" />
        <TrendChart data={data.trend} series={[{ key: "anonymousTopics", label: "话题", color: "#3f7f9b" }, { key: "anonymousMessages", label: "发言", color: "#6d75b8" }, { key: "anonymousLikes", label: "点评获赞", color: "#b15c76" }, { key: "anonymousFavorites", label: "话题喜欢", color: "#c08338" }]} title="匿名话题" />
      </div>
      <div className="analytics-rankings">
        <Ranking title="热门作者" items={data.rankings.authors} kind="author" />
        <Ranking title="热门文章" items={data.rankings.articles} kind="article" />
        <Ranking title="热门搜索" items={data.rankings.searches} kind="search" />
        <Ranking title="订阅增长" items={data.rankings.subscriptionGrowth} kind="author" />
        <Ranking title="热门匿名话题" items={data.rankings.anonymousTopics} kind="topic" />
      </div>
      <details className="analytics-definitions"><summary>统计口径</summary><div>{data.definitions.map((item) => <p key={item.key}><strong>{item.label}</strong><span>{item.definition}</span></p>)}</div></details>
      <span className="analytics-generated">最近聚合：{data.latestAggregateAt ? formatTime(data.latestAggregateAt) : "尚未生成"} · 页面读取：{formatTime(data.generatedAt)}</span>
    </> : null}
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function Ranking({ items, kind, title }: { items: AnalyticsRankingItem[]; kind: "author" | "article" | "search" | "topic"; title: string }) {
  return <section className="analytics-ranking"><header><strong>{title}</strong><span>{items.length ? `前 ${items.length}` : "暂无数据"}</span></header><ol>{items.map((item, index) => {
    const slug = typeof item.metadata?.slug === "string" ? item.metadata.slug : "";
    const content = <><b>{index + 1}</b><span><strong>{item.label}</strong><small>{item.secondary}</small></span><em>{item.score.toLocaleString("zh-CN")}</em></>;
    if (kind === "article" && slug) return <li key={item.key}><Link href={`/articles/${slug}`}>{content}</Link></li>;
    return <li key={item.key}><div>{content}</div></li>;
  })}</ol></section>;
}

// The SVG chart uses a fixed coordinate system so changing browser width does not change data scaling.
function TrendChart({ data, series, title }: { data: AnalyticsTrendPoint[]; series: Array<{ key: SeriesKey; label: string; color: string }>; title: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 760;
  const height = 238;
  const padding = { top: 20, right: 20, bottom: 32, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...data.flatMap((point) => series.map(({ key }) => point[key])));
  const x = (index: number) => padding.left + (data.length <= 1 ? 0 : index / (data.length - 1)) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const labelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return <section className="analytics-chart"><header><strong>{title}</strong><span>{series.map((item) => <i key={item.key}><b style={{ background: item.color }} />{item.label}</i>)}</span></header><div className="analytics-chart-canvas"><svg aria-label={`${title}折线图`} role="img" viewBox={`0 0 ${width} ${height}`}><line className="analytics-axis" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} />{[0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line className="analytics-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * (1 - ratio)} y2={padding.top + plotHeight * (1 - ratio)} /><text className="analytics-y-label" x={padding.left - 7} y={padding.top + plotHeight * (1 - ratio) + 4}>{Math.round(maxValue * ratio)}</text></g>)}{series.map((item) => <g key={item.key}><polyline fill="none" points={data.map((point, index) => `${x(index)},${y(point[item.key])}`).join(" ")} stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />{data.map((point, index) => <circle className="analytics-point" cx={x(index)} cy={y(point[item.key])} fill={item.color} key={`${item.key}-${point.date}`} r="3.2" />)}</g>)}{data.map((point, index) => labelIndexes.has(index) ? <text className="analytics-x-label" key={point.date} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} x={x(index)} y={height - 9}>{point.date.slice(5)}</text> : null)}{data.map((point, index) => <rect aria-label={`${point.date} 数据`} className="analytics-point-hit" fill="transparent" height={height} key={`hit-${point.date}`} onFocus={() => setHoveredIndex(index)} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} tabIndex={0} width={data.length <= 1 ? plotWidth : index === 0 ? plotWidth / (data.length - 1) / 2 : index === data.length - 1 ? plotWidth / (data.length - 1) / 2 : plotWidth / (data.length - 1)} x={index === 0 ? padding.left : x(index) - plotWidth / (data.length - 1) / 2} y="0" />)}</svg>{hoveredIndex !== null ? <div className={`analytics-chart-tooltip ${hoveredIndex === 0 ? "left" : hoveredIndex === data.length - 1 ? "right" : ""}`} style={{ left: `${(x(hoveredIndex) / width) * 100}%` }}><strong>{data[hoveredIndex].date}</strong>{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}：{data[hoveredIndex][item.key]}</span>)}</div> : null}</div></section>;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
