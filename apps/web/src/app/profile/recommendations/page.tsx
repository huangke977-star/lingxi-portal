"use client";

import { EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { clearRecommendationFeedback, listRecommendationFeedback, removeRecommendationFeedback, type RecommendationFeedbackItem, type RecommendationTargetType } from "@/lib/discovery-api";
import { localizedPath } from "@/lib/i18n";
import { useRouter } from "next/navigation";

const types: Array<{ value: "all" | RecommendationTargetType; zh: string; en: string }> = [
  { value: "all", zh: "全部类型", en: "All types" },
  { value: "article", zh: "文章", en: "Articles" },
  { value: "topic", zh: "专题", en: "Topics" },
  { value: "collection", zh: "合集", en: "Collections" },
  { value: "author", zh: "作者", en: "Authors" },
  { value: "group", zh: "群聊", en: "Groups" },
];

export default function RecommendationFeedbackPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [items, setItems] = useState<RecommendationFeedbackItem[]>([]);
  const [type, setType] = useState<"all" | RecommendationTargetType>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const token = readAccessToken();
    if (!token) { router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/profile/recommendations", locale))}`); return; }
    try { await getMe(token); setItems((await listRecommendationFeedback(token, type === "all" ? undefined : type)).items); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取推荐反馈。", "Could not load recommendation feedback.")); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => { setLoading(true); void load(); }, 0); return () => window.clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, type]);

  async function restore(item: RecommendationFeedbackItem) {
    const token = readAccessToken(); if (!token) return;
    try { await removeRecommendationFeedback(token, item.targetType, item.targetId); setItems((current) => current.filter((entry) => entry.id !== item.id)); setNotice(phrase("已恢复该项推荐。", "Recommendation restored.")); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("恢复失败。", "Could not restore recommendation.")); }
  }

  async function clear() {
    if (!(await confirm(phrase(type === "all" ? "清理全部不感兴趣反馈吗？" : "清理当前类型的不感兴趣反馈吗？", type === "all" ? "Clear all not-interested feedback?" : "Clear feedback for this type?"), { danger: true }))) return;
    const token = readAccessToken(); if (!token) return;
    try { const result = await clearRecommendationFeedback(token, type === "all" ? undefined : type); setItems([]); setNotice(phrase(`已清理 ${result.count} 条反馈。`, `Cleared ${result.count} feedback item(s).`)); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("清理失败。", "Could not clear feedback.")); }
  }

  return <section className="page-shell recommendation-feedback-page"><header className="profile-subpage-heading"><div><span className="section-label"><EyeOff aria-hidden="true" size={14} /> RECOMMENDATION FEEDBACK</span><h1>{phrase("推荐反馈", "Recommendation feedback")}</h1><p>{phrase("管理你标记为不感兴趣的推荐，恢复后会重新参与推荐。", "Manage items marked not interested. Restored items can appear in recommendations again.")}</p></div><button className="text-action" onClick={() => router.push(localizedPath("/articles", locale))} type="button">{phrase("返回发现", "Back to discovery")}</button></header><div className="recommendation-feedback-toolbar"><GlassSelect ariaLabel={phrase("反馈类型", "Feedback type")} onChange={(value) => setType(value as typeof type)} options={types.map((item) => ({ value: item.value, label: phrase(item.zh, item.en) }))} value={type} /><button className="text-action danger" disabled={!items.length} onClick={() => void clear()} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("清理当前反馈", "Clear feedback")}</button></div>{loading ? <div className="article-empty-state">{phrase("正在读取推荐反馈。", "Loading recommendation feedback.")}</div> : items.length ? <div className="recommendation-feedback-list">{items.map((item) => <article key={item.id}><span><strong>{item.label}</strong><small>{phrase(item.targetType === "article" ? "文章" : item.targetType === "topic" ? "专题" : item.targetType === "collection" ? "合集" : item.targetType === "author" ? "作者" : "群聊", item.targetType)} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span><button aria-label={phrase("恢复推荐", "Restore recommendation")} className="table-icon-action" onClick={() => void restore(item)} title={phrase("恢复推荐", "Restore recommendation")} type="button"><RotateCcw aria-hidden="true" size={16} /></button></article>)}</div> : <div className="article-empty-state"><strong>{phrase("没有不感兴趣反馈", "No not-interested feedback")}</strong><span>{phrase("你标记不感兴趣的内容会出现在这里。", "Items you mark not interested will appear here.")}</span></div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
