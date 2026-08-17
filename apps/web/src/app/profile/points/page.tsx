"use client";

import { useEffect, useState } from "react";
import { Coins, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { getMyReputation, getMyReputationLedger, type ReputationLedger, type ReputationSummary } from "@/lib/reputation-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";

function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
function delta(value: number) { return `${value > 0 ? "+" : ""}${value}`; }

export default function PointsPage() {
  const [summary, setSummary] = useState<ReputationSummary | null>(null);
  const [items, setItems] = useState<ReputationLedger[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { window.location.href = "/login?from=%2Fprofile%2Fpoints"; return; }
    Promise.all([getMyReputation(token), getMyReputationLedger(token, 1, 20)]).then(([nextSummary, nextLedger]) => {
      setSummary(nextSummary); setItems(nextLedger.items); setTotalPages(nextLedger.totalPages);
    }).catch((loadError) => { if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.href = "/login"; return; } setError(loadError instanceof Error ? loadError.message : "无法读取积分明细。"); }).finally(() => setIsLoading(false));
  }, []);

  async function changePage(nextPage: number) {
    const token = readAccessToken(); if (!token || nextPage < 1 || nextPage > totalPages) return;
    try { const result = await getMyReputationLedger(token, nextPage, 20); setItems(result.items); setPage(result.page); setTotalPages(result.totalPages); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法读取积分明细。"); }
  }

  return <section className="page-shell points-page"><header className="points-page-heading"><div><span className="section-label"><Coins aria-hidden="true" size={14} /> POINTS LEDGER</span><h1>积分明细</h1><p>记录积分获取、扣除和 72 小时待入账状态。</p></div><div className="points-balance"><strong>{summary?.points ?? 0}</strong><span>当前积分</span><small>待入账 {summary?.pendingPoints ?? 0}</small></div></header>{isLoading ? <div className="article-empty-state">正在读取积分明细。</div> : <div className="points-ledger-table"><div className="points-ledger-head"><span>事项</span><span>经验</span><span>积分</span><span>时间</span><span>状态</span></div>{items.length ? items.map((item) => <article key={item.id}><div><strong>{item.description}</strong><small>{formatDate(item.createdAt)}</small></div><span>{item.experienceDelta ? delta(item.experienceDelta) : "-"}</span><span className={item.pointDelta < 0 ? "negative" : ""}>{item.pointDelta ? delta(item.pointDelta) : item.pendingPointDelta ? `待入账 +${item.pendingPointDelta}` : "-"}</span><span><small>{item.pendingPointDelta && !item.settledAt ? `预计 ${formatDate(item.availableAt)}` : item.settledAt ? `已于 ${formatDate(item.settledAt)}到账` : "即时"}</small></span><span className={`ledger-status ${item.pendingPointDelta && !item.settledAt ? "pending" : "settled"}`}>{item.pendingPointDelta && !item.settledAt ? <><Clock3 size={13} />待入账</> : "已入账"}</span></article>) : <p className="points-empty">暂无积分记录。</p>}</div>}{totalPages > 1 ? <footer className="points-pagination"><button disabled={page <= 1} onClick={() => void changePage(page - 1)} type="button"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => void changePage(page + 1)} type="button"><ChevronRight size={16} /></button></footer> : null}<AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
