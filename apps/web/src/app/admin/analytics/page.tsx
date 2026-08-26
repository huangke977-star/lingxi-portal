"use client";

import {
  Activity,
  Ban,
  Bell,
  Bookmark,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Coins,
  Compass,
  Eye,
  FileText,
  Flag,
  Heart,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  MousePointerClick,
  RefreshCw,
  Rss,
  ShieldAlert,
  ShoppingBag,
  ThumbsUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import {
  AdminAnalytics,
  AnalyticsRankingItem,
  AnalyticsTrendPoint,
  getAdminAnalytics,
  rebuildAdminAnalytics,
} from "@/lib/analytics-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { analyticsDefinitionDescription, analyticsDefinitionLabel, analyticsRankingSecondary } from "@/lib/system-labels";
import { isSiteManager } from "@/lib/user-permissions";

type Range = 7 | 30 | 90;
type SeriesKey = Exclude<keyof AnalyticsTrendPoint, "date">;

const metrics: Array<{ key: SeriesKey; label: readonly [string, string]; icon: typeof Activity }> = [
  { key: "newUsers", label: ["新增用户", "New users"], icon: Users },
  { key: "activeUsers", label: ["活跃用户", "Active users"], icon: Activity },
  { key: "articles", label: ["发布文章", "Published articles"], icon: FileText },
  { key: "comments", label: ["评论", "Comments"], icon: MessageCircle },
  { key: "messages", label: ["聊天消息", "Chat messages"], icon: MessageCircle },
  { key: "views", label: ["文章阅读", "Article views"], icon: Eye },
  { key: "likes", label: ["点赞", "Likes"], icon: Heart },
  { key: "favorites", label: ["收藏", "Favorites"], icon: Bookmark },
  { key: "subscriptions", label: ["订阅增长", "Subscription growth"], icon: Rss },
  { key: "reports", label: ["举报", "Reports"], icon: Flag },
  { key: "disabledUsers", label: ["停用账号", "Disabled accounts"], icon: Ban },
  { key: "loginRisks", label: ["登录风险", "Sign-in risks"], icon: ShieldAlert },
  { key: "failedJobs", label: ["异常任务", "Failed jobs"], icon: ShieldAlert },
  { key: "anonymousTopics", label: ["匿名话题", "Anonymous topics"], icon: MessagesSquare },
  { key: "anonymousMessages", label: ["匿名发言", "Anonymous messages"], icon: MessageCircle },
  { key: "anonymousLikes", label: ["点评获赞", "Message likes"], icon: ThumbsUp },
  { key: "anonymousFavorites", label: ["话题喜欢", "Topic favorites"], icon: Heart },
  { key: "notifications", label: ["通知创建", "Notifications created"], icon: Bell },
  { key: "notificationReads", label: ["通知已读", "Notifications read"], icon: CheckCheck },
  { key: "notificationOpens", label: ["通知打开", "Notifications opened"], icon: MousePointerClick },
  { key: "onboardingCompleted", label: ["兴趣指引完成", "Interest onboarding completed"], icon: Compass },
  { key: "resourceExchanges", label: ["资源兑换", "Resource unlocks"], icon: ShoppingBag },
  { key: "resourcePointsSpent", label: ["资源兑换积分", "Resource points spent"], icon: Coins },
  { key: "resourcePointsPending", label: ["资源待入账积分", "Pending resource points"], icon: Clock3 },
  { key: "resourcePointsSettled", label: ["资源已到账积分", "Settled resource points"], icon: CheckCircle2 },
];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
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
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/analytics", locale))}`);
      return;
    }
    setIsLoading(true);
    try {
      const [currentUser, result] = await Promise.all([getMe(token), getAdminAnalytics(token, currentRange)]);
      if (!isSiteManager(currentUser)) {
        setUser(currentUser);
        setError(phrase("当前账号没有查看运营数据的权限。", "This account cannot view operations analytics."));
        return;
      }
      setUser(currentUser);
      setData(result);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(loadError instanceof Error ? loadError.message : phrase("运营数据加载失败。", "Could not load operations analytics."));
    } finally {
      setIsLoading(false);
    }
  }, [locale, phrase, router]);

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
      setNotice(result.days ? phrase(`最近 ${result.days} 天的运营数据已补算完成。`, `Operations analytics for the last ${result.days} days was rebuilt.`) : phrase("运营数据补算任务正在执行。", "Operations analytics rebuild is running."));
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : phrase("运营数据补算失败。", "Could not rebuild operations analytics."));
    } finally {
      setIsRebuilding(false);
    }
  }

  if (!isLoading && user && !isSiteManager(user)) {
    return <section className="page-shell analytics-page"><div className="search-page-empty"><strong>{phrase("无法进入运营分析", "Cannot open operations analytics")}</strong><span>{error}</span></div></section>;
  }

  return <section className="page-shell analytics-page">
    <AdminPageHeader className="analytics-toolbar" description={phrase("按中国时区自然日聚合，页面只读取聚合结果。", "Data is aggregated by calendar day in the China time zone; this page reads the aggregates only.")} title={phrase("运营数据", "Operations analytics")} actions={<div className="analytics-toolbar-actions">
        <div className="analytics-range" role="group" aria-label={phrase("统计范围", "Analytics range")}>{([7, 30, 90] as const).map((value) => <button className={range === value ? "active" : undefined} key={value} onClick={() => setRange(value)} type="button">{phrase(`${value} 天`, `${value} days`)}</button>)}</div>
        <button aria-label={phrase("重新补算运营数据", "Rebuild operations analytics")} className="analytics-rebuild" disabled={isLoading || isRebuilding} onClick={() => void rebuild()} title={phrase(`补算最近 ${range} 天`, `Rebuild the last ${range} days`)} type="button">{isRebuilding ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <RefreshCw aria-hidden="true" size={16} />}</button>
      </div>} />
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />{phrase("正在读取聚合数据。", "Loading aggregated analytics.")}</div> : data ? <>
      <div className="analytics-metrics">{metrics.map(({ key, label, icon: Icon }) => <article className={key === "failedJobs" || key === "loginRisks" || key === "reports" ? "warning" : undefined} key={key}><Icon aria-hidden="true" size={17} /><span><small>{label[locale === "en-US" ? 1 : 0]}</small><strong>{data.summary[key].toLocaleString(locale)}</strong></span></article>)}</div>
      <section className="analytics-conversion" aria-label={phrase("通知转化统计", "Notification conversion") }>
        <div><Bell aria-hidden="true" size={16} /><span><small>{phrase("通知已读率", "Read rate")}</small><strong>{data.notificationConversion.readRate.toLocaleString(locale)}%</strong></span></div>
        <div><MousePointerClick aria-hidden="true" size={16} /><span><small>{phrase("通知打开率", "Open rate")}</small><strong>{data.notificationConversion.openRate.toLocaleString(locale)}%</strong></span></div>
        <div><Compass aria-hidden="true" size={16} /><span><small>{phrase("兴趣指引完成率", "Interest onboarding completion")}</small><strong>{data.onboardingConversion.completionRate.toLocaleString(locale)}%</strong></span></div>
        <p>{phrase(`兴趣指引本期完成 ${data.onboardingConversion.completed.toLocaleString(locale)} 次；完成率按本期完成次数与新增用户数计算。`, `${data.onboardingConversion.completed.toLocaleString(locale)} interest-onboarding completions in this period; completion rate is calculated against new users in the same period.`)}</p>
      </section>
      <div className="analytics-charts">
        <TrendChart data={data.trend} series={[{ key: "newUsers", label: phrase("新增", "New"), color: "#4b78d1" }, { key: "activeUsers", label: phrase("活跃", "Active"), color: "#2f9378" }, { key: "articles", label: phrase("文章", "Articles"), color: "#a46cbd" }]} title={phrase("用户与内容", "Users and content")} />
        <TrendChart data={data.trend} series={[{ key: "comments", label: phrase("评论", "Comments"), color: "#4f86a8" }, { key: "messages", label: phrase("消息", "Messages"), color: "#7359a8" }, { key: "views", label: phrase("阅读", "Views"), color: "#2f9378" }]} title={phrase("访问与交流", "Visits and discussion")} />
        <TrendChart data={data.trend} series={[{ key: "reports", label: phrase("举报", "Reports"), color: "#d15f79" }, { key: "loginRisks", label: phrase("风险", "Risks"), color: "#c07b31" }, { key: "failedJobs", label: phrase("异常任务", "Failed jobs"), color: "#8d5961" }]} title={phrase("风险与异常", "Risks and issues")} />
        <TrendChart data={data.trend} series={[{ key: "anonymousTopics", label: phrase("话题", "Topics"), color: "#3f7f9b" }, { key: "anonymousMessages", label: phrase("发言", "Messages"), color: "#6d75b8" }, { key: "anonymousLikes", label: phrase("点评获赞", "Message likes"), color: "#b15c76" }, { key: "anonymousFavorites", label: phrase("话题喜欢", "Topic favorites"), color: "#c08338" }]} title={phrase("匿名话题", "Anonymous topics")} />
        <TrendChart data={data.trend} series={[{ key: "resourceExchanges", label: phrase("兑换", "Unlocks"), color: "#497f9a" }, { key: "resourcePointsSpent", label: phrase("兑换积分", "Points spent"), color: "#b56b46" }, { key: "resourcePointsSettled", label: phrase("到账积分", "Settled points"), color: "#37876d" }]} title={phrase("资源交易", "Resource exchange")} />
      </div>
      <div className="analytics-rankings">
        <Ranking category="author" title={phrase("热门作者", "Popular authors")} items={data.rankings.authors} kind="author" />
        <Ranking category="article" title={phrase("热门文章", "Popular articles")} items={data.rankings.articles} kind="article" />
        <Ranking category="search" title={phrase("热门搜索", "Popular searches")} items={data.rankings.searches} kind="search" />
        <Ranking category="subscription_growth" title={phrase("订阅增长", "Subscription growth")} items={data.rankings.subscriptionGrowth} kind="author" />
        <Ranking category="anonymous_topic" title={phrase("热门匿名话题", "Popular anonymous topics")} items={data.rankings.anonymousTopics} kind="topic" />
      </div>
      <details className="analytics-definitions"><summary>{phrase("统计口径", "Definitions")}</summary><div>{data.definitions.map((item) => <p key={item.key}><strong>{analyticsDefinitionLabel(item.key, locale, item.label)}</strong><span>{analyticsDefinitionDescription(item.key, locale, item.definition)}</span></p>)}</div></details>
      <span className="analytics-generated">{phrase("最近聚合：", "Latest aggregate: ")}{data.latestAggregateAt ? formatTime(data.latestAggregateAt, locale) : phrase("尚未生成", "Not generated")} · {phrase("页面读取：", "Page read: ")}{formatTime(data.generatedAt, locale)}</span>
    </> : null}
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function Ranking({ category, items, kind, title }: { category: "author" | "article" | "search" | "subscription_growth" | "anonymous_topic"; items: AnalyticsRankingItem[]; kind: "author" | "article" | "search" | "topic"; title: string }) {
  const { locale, phrase } = useLanguage();
  return <section className="analytics-ranking"><header><strong>{title}</strong><span>{items.length ? phrase(`前 ${items.length}`, `Top ${items.length}`) : phrase("暂无数据", "No data")}</span></header><ol>{items.map((item, index) => {
    const slug = typeof item.metadata?.slug === "string" ? item.metadata.slug : "";
    const content = <><b>{index + 1}</b><span><strong>{item.label}</strong><small>{analyticsRankingSecondary(category, item.secondary, locale)}</small></span><em>{item.score.toLocaleString(locale)}</em></>;
    if (kind === "article" && slug) return <li key={item.key}><Link href={localizedPath(`/articles/${slug}`, locale)}>{content}</Link></li>;
    return <li key={item.key}><div>{content}</div></li>;
  })}</ol></section>;
}

// The SVG chart uses a fixed coordinate system so changing browser width does not change data scaling.
function TrendChart({ data, series, title }: { data: AnalyticsTrendPoint[]; series: Array<{ key: SeriesKey; label: string; color: string }>; title: string }) {
  const { phrase } = useLanguage();
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
  return <section className="analytics-chart"><header><strong>{title}</strong><span>{series.map((item) => <i key={item.key}><b style={{ background: item.color }} />{item.label}</i>)}</span></header><div className="analytics-chart-canvas"><svg aria-label={phrase(`${title}折线图`, `${title} line chart`)} role="img" viewBox={`0 0 ${width} ${height}`}><line className="analytics-axis" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} />{[0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line className="analytics-grid-line" x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight * (1 - ratio)} y2={padding.top + plotHeight * (1 - ratio)} /><text className="analytics-y-label" x={padding.left - 7} y={padding.top + plotHeight * (1 - ratio) + 4}>{Math.round(maxValue * ratio)}</text></g>)}{series.map((item) => <g key={item.key}><polyline fill="none" points={data.map((point, index) => `${x(index)},${y(point[item.key])}`).join(" ")} stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />{data.map((point, index) => <circle className="analytics-point" cx={x(index)} cy={y(point[item.key])} fill={item.color} key={`${item.key}-${point.date}`} r="3.2" />)}</g>)}{data.map((point, index) => labelIndexes.has(index) ? <text className="analytics-x-label" key={point.date} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} x={x(index)} y={height - 9}>{point.date.slice(5)}</text> : null)}{data.map((point, index) => <rect aria-label={phrase(`${point.date} 数据`, `${point.date} data`)} className="analytics-point-hit" fill="transparent" height={height} key={`hit-${point.date}`} onFocus={() => setHoveredIndex(index)} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} tabIndex={0} width={data.length <= 1 ? plotWidth : index === 0 ? plotWidth / (data.length - 1) / 2 : index === data.length - 1 ? plotWidth / (data.length - 1) / 2 : plotWidth / (data.length - 1)} x={index === 0 ? padding.left : x(index) - plotWidth / (data.length - 1) / 2} y="0" />)}</svg>{hoveredIndex !== null ? <div className={`analytics-chart-tooltip ${hoveredIndex === 0 ? "left" : hoveredIndex === data.length - 1 ? "right" : ""}`} style={{ left: `${(x(hoveredIndex) / width) * 100}%` }}><strong>{data[hoveredIndex].date}</strong>{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}: {data[hoveredIndex][item.key]}</span>)}</div> : null}</div></section>;
}

function formatTime(value: string, locale: "zh-CN" | "en-US"): string {
  return new Date(value).toLocaleString(locale, { hour12: false });
}
