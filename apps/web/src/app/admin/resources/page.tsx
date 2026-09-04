"use client";

import { Coins, RefreshCw, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState, type FormEvent } from "react";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import {
  applyViolationPenalty,
  listAdminPointAdjustments,
  listAdminResourceDeliveries,
  markResourceDeliveryFailed,
  refundResourceDelivery,
  topUpUserPoints,
  type AdminPointAdjustment,
  type ResourceDelivery,
} from "@/lib/resource-api";
import { isSiteManager } from "@/lib/user-permissions";
import { useRouter } from "next/navigation";

type AdjustmentKind = "top-up" | "violation";

export default function AdminResourcesPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<ResourceDelivery[]>([]);
  const [adjustments, setAdjustments] = useState<AdminPointAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
  const [adjustmentKind, setAdjustmentKind] = useState<AdjustmentKind>("top-up");
  const [username, setUsername] = useState("");
  const [points, setPoints] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/resources", locale))}`);
      return;
    }
    try {
      const current = await getMe(token);
      setUser(current);
      if (!isSiteManager(current)) return;
      const [deliveryPage, adjustmentPage] = await Promise.all([
        listAdminResourceDeliveries(token),
        listAdminPointAdjustments(token),
      ]);
      setItems(deliveryPage.items);
      setAdjustments(adjustmentPage.items);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(loadError instanceof Error ? loadError.message : phrase("无法读取资源记录。", "Could not load resource records."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  function resetAdjustmentForm() {
    setUsername("");
    setPoints("");
    setEventKey("");
    setNote("");
  }

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    const parsedPoints = Number(points);
    if (!token || !username.trim() || !Number.isInteger(parsedPoints) || parsedPoints < 1 || !eventKey.trim()) {
      setError(phrase("请填写有效的 @用户名、积分数量和唯一事件键。", "Enter a valid @username, point amount, and unique event key."));
      return;
    }
    try {
      const result = adjustmentKind === "top-up"
        ? await topUpUserPoints(token, { username: username.trim(), points: parsedPoints, eventKey: eventKey.trim(), note })
        : await applyViolationPenalty(token, { username: username.trim(), points: parsedPoints, eventKey: eventKey.trim(), note });
      setNotice(result.applied ? phrase("积分账本已更新。", "Points ledger updated.") : phrase("该事件键已经处理过。", "This event key was already processed."));
      resetAdjustmentForm();
      setIsAdjustmentOpen(false);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("积分操作失败。", "Points operation failed."));
    }
  }

  async function deliveryAction(item: ResourceDelivery, kind: "fail" | "refund") {
    const token = readAccessToken();
    if (!token) return;
    if (kind === "refund" && !(await confirm(phrase(`确认退款《${item.article.title}》的兑换吗？`, `Refund the redemption for “${item.article.title}”?`), { danger: true }))) return;
    try {
      if (kind === "refund") await refundResourceDelivery(token, item.id);
      else await markResourceDeliveryFailed(token, item.id, phrase("管理员记录交付失败", "Administrator recorded a delivery failure"));
      await load();
      setNotice(kind === "refund" ? phrase("已退款并写入账本。", "Refunded and recorded in the ledger.") : phrase("已记录交付失败。", "Delivery failure recorded."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("操作失败。", "Action failed."));
    }
  }

  function closeAdjustment() {
    setIsAdjustmentOpen(false);
    setError("");
  }

  if (loading) return <AdminPageLoading description={phrase("管理积分资源交付、退款和积分调整。", "Manage resource delivery, refunds, and point adjustments.")} loadingLabel={phrase("正在读取资源记录", "Loading resource records")} title={phrase("资源与积分", "Resources and points")} />;
  if (!user || !isSiteManager(user)) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("无权访问", "Access denied")} description={phrase("该页面仅管理员可访问。", "This page is available only to administrators.")} /></section>;

  return <section className="page-shell admin-shell admin-resources-page">
    <AdminPageHeader
      title={phrase("资源与积分", "Resources and points")}
      description={phrase("处理交付记录，并通过可审计账本补发或扣除积分。", "Manage delivery records and adjust points through an auditable ledger.")}
      actions={<>{user.isSuperAdmin ? <button aria-label={phrase("积分调整", "Adjust points")} className="admin-header-icon-action" onClick={() => { setError(""); setIsAdjustmentOpen(true); }} title={phrase("积分调整", "Adjust points")} type="button"><Coins aria-hidden="true" size={17} /></button> : null}<button aria-label={phrase("刷新", "Refresh")} className="admin-header-icon-action" onClick={() => { setLoading(true); void load(); }} title={phrase("刷新", "Refresh")} type="button"><RefreshCw aria-hidden="true" size={17} /></button></>}
    />

    <section className="resource-admin-delivery-panel">
      <header><strong>{phrase("最近交付记录", "Recent deliveries")}</strong><small>{items.length}</small></header>
      {items.length ? <div className="resource-admin-delivery-list">{items.map((item) => <article key={item.id}>
        <span><strong>{item.article.title}</strong><small>{item.buyer.nickname} · {item.pointCost} {phrase("积分", "points")} · {item.status}</small></span>
        <div>{item.status !== "refunded" ? <button aria-label={phrase("退款", "Refund")} className="table-icon-action" onClick={() => void deliveryAction(item, "refund")} title={phrase("退款", "Refund")} type="button"><RotateCcw aria-hidden="true" size={15} /></button> : null}{item.status !== "refunded" && item.status !== "failed" ? <button aria-label={phrase("记录失败", "Mark failed")} className="table-icon-action" onClick={() => void deliveryAction(item, "fail")} title={phrase("记录失败", "Mark failed")} type="button"><ShieldAlert aria-hidden="true" size={15} /></button> : null}</div>
      </article>)}</div> : <div className="article-empty-state">{phrase("暂无资源交付记录。", "No resource deliveries yet.")}</div>}
    </section>

    <section className="resource-admin-delivery-panel resource-admin-adjustment-panel">
      <header><strong>{phrase("积分调整记录", "Point adjustment history")}</strong><small>{adjustments.length}</small></header>
      {adjustments.length ? <div className="resource-admin-adjustment-list">{adjustments.map((item) => <article key={item.id}>
        <span><strong>{item.user.nickname} <small>@{item.user.username}</small></strong><small>{item.description} · {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span>
        <span className={`resource-adjustment-value ${item.pointDelta < 0 ? "negative" : "positive"}`}>{item.pointDelta > 0 ? "+" : ""}{item.pointDelta}</span>
      </article>)}</div> : <div className="article-empty-state">{phrase("暂无积分调整记录。", "No point adjustments yet.")}</div>}
    </section>

    {isAdjustmentOpen && typeof document !== "undefined" ? createPortal(<div className="modal-backdrop announcement-editor-backdrop resource-adjustment-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeAdjustment(); }}>
      <form aria-label={phrase("积分调整", "Point adjustment")} aria-modal="true" className="announcement-editor resource-adjustment-dialog" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => void adjust(event)} role="dialog">
        <header><span><Coins aria-hidden="true" size={17} /><strong>{phrase("积分调整", "Point adjustment")}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={closeAdjustment} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={17} /></button></header>
        <div className="announcement-editor-body resource-adjustment-dialog-body">
          <div className="resource-adjustment-kind" role="group" aria-label={phrase("调整类型", "Adjustment type")}>
            <button aria-pressed={adjustmentKind === "top-up"} onClick={() => setAdjustmentKind("top-up")} type="button"><Undo2 aria-hidden="true" size={15} />{phrase("补发积分", "Top up")}</button>
            <button aria-pressed={adjustmentKind === "violation"} onClick={() => setAdjustmentKind("violation")} type="button"><ShieldAlert aria-hidden="true" size={15} />{phrase("违规扣分", "Violation penalty")}</button>
          </div>
          <label><span>{phrase("目标用户", "Target user")}</span><input aria-label={phrase("用户名", "Username")} autoFocus onChange={(event) => setUsername(event.target.value)} placeholder={phrase("@用户名", "@username")} required type="text" value={username} /></label>
          <label><span>{phrase("积分数量", "Points")}</span><input aria-label={phrase("积分数量", "Points")} min="1" onChange={(event) => setPoints(event.target.value)} placeholder={phrase("请输入正整数", "Enter a positive integer")} required type="number" value={points} /></label>
          <label className="wide"><span>{phrase("唯一事件键", "Unique event key")}</span><input aria-label={phrase("唯一事件键", "Unique event key")} onChange={(event) => setEventKey(event.target.value)} placeholder={phrase("例如：case-20260904-01", "For example: case-20260904-01")} required value={eventKey} /></label>
          <label className="wide"><span>{phrase("备注（可选）", "Note (optional)")}</span><input aria-label={phrase("备注", "Note")} onChange={(event) => setNote(event.target.value)} placeholder={phrase("说明本次调整原因", "Explain this adjustment")} value={note} /></label>
        </div>
        <footer><button aria-label={phrase("取消", "Cancel")} onClick={closeAdjustment} title={phrase("取消", "Cancel")} type="button"><X aria-hidden="true" size={16} /></button><button aria-label={phrase("确定", "Confirm")} className="primary" title={phrase("确定", "Confirm")} type="submit"><Coins aria-hidden="true" size={16} /></button></footer>
      </form>
    </div>, document.body) : null}

    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
