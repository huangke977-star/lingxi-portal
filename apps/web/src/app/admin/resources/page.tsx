"use client";

import { Coins, RefreshCw, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { applyViolationPenalty, listAdminResourceDeliveries, markResourceDeliveryFailed, refundResourceDelivery, topUpUserPoints, type ResourceDelivery } from "@/lib/resource-api";
import { isSiteManager } from "@/lib/user-permissions";
import { useRouter } from "next/navigation";

export default function AdminResourcesPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<ResourceDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("");
  const [points, setPoints] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const token = readAccessToken();
    if (!token) { router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/resources", locale))}`); return; }
    try { const current = await getMe(token); setUser(current); if (!isSiteManager(current)) return; setItems((await listAdminResourceDeliveries(token)).items); }
    catch (loadError) { if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace(localizedPath("/", locale)); return; } setError(loadError instanceof Error ? loadError.message : phrase("无法读取资源记录。", "Could not load resource records.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function adjust(kind: "top-up" | "violation") {
    const token = readAccessToken(); const parsedPoints = Number(points);
    if (!token || !username.trim() || !Number.isInteger(parsedPoints) || parsedPoints < 1 || !eventKey.trim()) { setError(phrase("请填写有效的 @用户名、积分数量和唯一事件键。", "Enter a valid @username, point amount, and unique event key.")); return; }
    try { const result = kind === "top-up" ? await topUpUserPoints(token, { username: username.trim(), points: parsedPoints, eventKey: eventKey.trim(), note }) : await applyViolationPenalty(token, { username: username.trim(), points: parsedPoints, eventKey: eventKey.trim(), note }); setNotice(result.applied ? phrase("积分账本已更新。", "Points ledger updated.") : phrase("该事件键已经处理过。", "This event key was already processed.")); setUsername(""); setPoints(""); setEventKey(""); setNote(""); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("积分操作失败。", "Points operation failed.")); }
  }

  async function deliveryAction(item: ResourceDelivery, kind: "fail" | "refund") {
    const token = readAccessToken(); if (!token) return;
    if (kind === "refund" && !(await confirm(phrase(`确认退款《${item.article.title}》的兑换吗？`, `Refund the redemption for “${item.article.title}”?`), { danger: true }))) return;
    try { if (kind === "refund") await refundResourceDelivery(token, item.id); else await markResourceDeliveryFailed(token, item.id, phrase("管理员记录交付失败", "Administrator recorded a delivery failure")); await load(); setNotice(kind === "refund" ? phrase("已退款并写入账本。", "Refunded and recorded in the ledger.") : phrase("已记录交付失败。", "Delivery failure recorded.")); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("操作失败。", "Action failed.")); }
  }

  if (loading) return <AdminPageLoading description={phrase("管理积分资源交付、退款和积分调整。", "Manage resource delivery, refunds, and point adjustments.")} loadingLabel={phrase("正在读取资源记录", "Loading resource records")} title={phrase("资源与积分", "Resources and points")} />;
  if (!user || !isSiteManager(user)) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("无权访问", "Access denied")} description={phrase("该页面仅管理员可访问。", "This page is available only to administrators.")} /></section>;
  return <section className="page-shell admin-shell admin-resources-page"><AdminPageHeader title={phrase("资源与积分", "Resources and points")} description={phrase("处理交付记录，并通过可审计账本补发或扣除积分。", "Manage delivery records and adjust points through an auditable ledger.")} actions={<button aria-label={phrase("刷新", "Refresh")} className="admin-header-icon-action" onClick={() => { setLoading(true); void load(); }} title={phrase("刷新", "Refresh")} type="button"><RefreshCw aria-hidden="true" size={17} /></button>} />{user.isSuperAdmin ? <section className="resource-adjustment-panel"><header><Coins aria-hidden="true" size={17} /><strong>{phrase("积分调整（仅超级管理员）", "Point adjustments (super admin only)")}</strong></header><div className="resource-adjustment-form"><input aria-label={phrase("用户名", "Username")} onChange={(event) => setUsername(event.target.value)} placeholder={phrase("@用户名", "@username")} type="text" value={username} /><input aria-label={phrase("积分数量", "Points")} onChange={(event) => setPoints(event.target.value)} placeholder={phrase("积分数量", "Points")} type="number" value={points} /><input aria-label={phrase("唯一事件键", "Unique event key")} onChange={(event) => setEventKey(event.target.value)} placeholder={phrase("唯一事件键", "Unique event key")} value={eventKey} /><input aria-label={phrase("备注", "Note")} onChange={(event) => setNote(event.target.value)} placeholder={phrase("备注（可选）", "Note (optional)")} value={note} /><div><button className="text-action" onClick={() => void adjust("top-up")} type="button"><Undo2 aria-hidden="true" size={15} />{phrase("补发积分", "Top up")}</button><button className="text-action danger" onClick={() => void adjust("violation")} type="button"><ShieldAlert aria-hidden="true" size={15} />{phrase("违规扣分", "Violation")}</button></div></div></section> : null}<section className="resource-admin-delivery-panel"><header><strong>{phrase("最近交付记录", "Recent deliveries")}</strong><small>{items.length}</small></header>{items.length ? <div className="resource-admin-delivery-list">{items.map((item) => <article key={item.id}><span><strong>{item.article.title}</strong><small>{item.buyer.nickname} · {item.pointCost} {phrase("积分", "points")} · {item.status}</small></span><div>{item.status !== "refunded" ? <button aria-label={phrase("退款", "Refund")} className="table-icon-action" onClick={() => void deliveryAction(item, "refund")} title={phrase("退款", "Refund")} type="button"><RotateCcw aria-hidden="true" size={15} /></button> : null}{item.status !== "refunded" && item.status !== "failed" ? <button aria-label={phrase("记录失败", "Mark failed")} className="table-icon-action" onClick={() => void deliveryAction(item, "fail")} title={phrase("记录失败", "Mark failed")} type="button"><ShieldAlert aria-hidden="true" size={15} /></button> : null}</div></article>)}</div> : <div className="article-empty-state">{phrase("暂无资源交付记录。", "No resource deliveries yet.")}</div>}</section><AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
