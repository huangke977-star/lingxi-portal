"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMyReputation, getMyReputationLedger, type ReputationLedger, type ReputationSummary } from "@/lib/reputation-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";
import { formatDate as formatLocaleDate, localizedPath } from "@/lib/i18n";
import { reputationReasonLabel } from "@/lib/system-labels";

function formatDate(value: string | null, locale: "zh-CN" | "en-US") { return value ? formatLocaleDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "-"; }
function delta(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

export default function PointsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [summary, setSummary] = useState<ReputationSummary | null>(null);
  const [items, setItems] = useState<ReputationLedger[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/profile/points", locale))}`); return; }
    Promise.all([getMyReputation(token), getMyReputationLedger(token, 1, 20)]).then(([nextSummary, nextLedger]) => {
      setSummary(nextSummary); setItems(nextLedger.items); setTotalPages(nextLedger.totalPages);
    }).catch((loadError) => { if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace(localizedPath("/login", locale)); return; } setError(loadError instanceof Error ? loadError.message : phrase("无法读取积分明细。", "Could not load point details.")); }).finally(() => setIsLoading(false));
  }, [locale, phrase, router]);

  async function changePage(nextPage: number) {
    const token = readAccessToken(); if (!token || nextPage < 1 || nextPage > totalPages) return;
    try { const result = await getMyReputationLedger(token, nextPage, 20); setItems(result.items); setPage(result.page); setTotalPages(result.totalPages); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取积分明细。", "Could not load point details.")); }
  }

  return <section className="page-shell points-page"><header className="points-page-heading"><div>{locale === "zh-CN" ? <span className="section-label"><Coins aria-hidden="true" size={14} /> POINTS LEDGER</span> : null}<h1>{phrase("积分明细", "Point activity")}</h1><p>{phrase("记录积分获取、扣除和 72 小时待入账状态。", "Review points earned, spent, and pending for 72 hours.")}</p></div><div className="points-balance"><strong>{summary?.points ?? 0}</strong><span>{phrase("当前积分", "Available points")}</span><small>{phrase(`待入账 ${summary?.pendingPoints ?? 0}`, `${summary?.pendingPoints ?? 0} pending`)}</small></div></header>{isLoading ? <div className="article-empty-state">{phrase("正在读取积分明细。", "Loading point activity.")}</div> : <div className="points-ledger-table"><div className="points-ledger-head"><span>{phrase("事项", "Activity")}</span><span>{phrase("经验", "Experience")}</span><span>{phrase("积分", "Points")}</span><span>{phrase("时间", "Time")}</span><span>{phrase("状态", "Status")}</span></div>{items.length ? items.map((item) => <article key={item.id}><div><strong>{reputationReasonLabel(item.reason, locale, item.description)}</strong><small>{formatDate(item.createdAt, locale)}</small></div><span>{item.experienceDelta ? delta(item.experienceDelta) : "-"}</span><span className={item.pointDelta < 0 ? "negative" : ""}>{item.pointDelta ? delta(item.pointDelta) : item.pendingPointDelta ? phrase(`待入账 +${item.pendingPointDelta}`, `Pending +${item.pendingPointDelta}`) : "-"}</span><span><small>{item.pendingPointDelta && !item.settledAt ? phrase(`预计 ${formatDate(item.availableAt, locale)}`, `Expected ${formatDate(item.availableAt, locale)}`) : item.settledAt ? phrase(`已于 ${formatDate(item.settledAt, locale)}到账`, `Settled ${formatDate(item.settledAt, locale)}`) : phrase("即时", "Immediate")}</small></span><span className={`ledger-status ${item.pendingPointDelta && !item.settledAt ? "pending" : "settled"}`}>{item.pendingPointDelta && !item.settledAt ? <><Clock3 size={13} />{phrase("待入账", "Pending")}</> : phrase("已入账", "Settled")}</span></article>) : <p className="points-empty">{phrase("暂无积分记录。", "No point activity yet.")}</p>}</div>}{totalPages > 1 ? <footer className="points-pagination"><button aria-label={phrase("上一页", "Previous page")} disabled={page <= 1} onClick={() => void changePage(page - 1)} type="button"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button aria-label={phrase("下一页", "Next page")} disabled={page >= totalPages} onClick={() => void changePage(page + 1)} type="button"><ChevronRight size={16} /></button></footer> : null}<AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
