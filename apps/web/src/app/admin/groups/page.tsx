"use client";

import { Check, Flag, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { handleChatGroupReport, listChatGroupReports, type ChatGroupReport } from "@/lib/social-api";

export default function GroupReportsAdminPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ChatGroupReport[]>([]);
  const [status, setStatus] = useState<"pending" | "resolved" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Fadmin%2Fgroups");
      return;
    }
    Promise.all([getMe(token), listChatGroupReports(token, undefined, status)])
      .then(([currentUser, result]) => {
        if (!(currentUser.isSuperAdmin || currentUser.role.level >= 90)) {
          router.replace("/");
          return;
        }
        setReports(result.items);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "群聊举报读取失败。");
      })
      .finally(() => setIsLoading(false));
  }, [router, status]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) => [
      report.group.name,
      report.message.body,
      report.message.sender.nickname,
      report.reporter.nickname,
      report.detail ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(keyword)));
  }, [reports, search]);

  async function handle(report: ChatGroupReport, nextStatus: "resolved" | "rejected", deleteMessage: boolean) {
    const token = readAccessToken();
    if (!token) return;
    setBusyId(report.id);
    try {
      await handleChatGroupReport(token, report.id, {
        status: nextStatus,
        deleteMessage,
        resolution: nextStatus === "resolved" ? "站点管理员已处理" : "未发现违规",
      });
      setReports((current) => current.filter((item) => item.id !== report.id));
      setNotice(nextStatus === "resolved" ? "举报已处理。" : "举报已驳回。");
    } catch (handleError) {
      setError(handleError instanceof Error ? handleError.message : "举报处理失败。");
    } finally {
      setBusyId(0);
    }
  }

  return <section className="page-shell group-report-admin-page">
    <div className="group-report-admin-toolbar">
      <nav aria-label="举报状态"><button className={status === "pending" ? "active" : ""} onClick={() => setStatus("pending")} type="button">待处理</button><button className={status === "resolved" ? "active" : ""} onClick={() => setStatus("resolved")} type="button">已处理</button><button className={status === "rejected" ? "active" : ""} onClick={() => setStatus("rejected")} type="button">已驳回</button></nav>
      <label><Search aria-hidden="true" size={16} /><input aria-label="搜索群聊举报" onChange={(event) => setSearch(event.target.value)} placeholder="搜索群名、成员或内容" value={search} />{search ? <button aria-label="清空搜索" onClick={() => setSearch("")} type="button"><X aria-hidden="true" size={14} /></button> : null}</label>
    </div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />正在读取群聊举报。</div> : <div className="group-report-admin-list">{filtered.map((report) => <article key={report.id}>
      <span className="group-report-admin-icon"><Flag aria-hidden="true" size={17} /></span>
      <div><header><strong>{report.group.name}</strong><span>{report.reporter.nickname} 举报 {report.message.sender.nickname}</span><time>{new Date(report.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></header><q>{report.message.body || "附件消息"}</q><small>{report.detail || report.reason}</small></div>
      {status === "pending" ? <footer><button disabled={busyId === report.id} onClick={() => void handle(report, "rejected", false)} type="button"><Check aria-hidden="true" size={14} />驳回</button><button className="danger" disabled={busyId === report.id} onClick={() => void handle(report, "resolved", true)} type="button"><Trash2 aria-hidden="true" size={14} />删除消息</button></footer> : <span className={`group-report-admin-status ${report.status}`}>{report.status === "resolved" ? "已处理" : "已驳回"}</span>}
    </article>)}{!filtered.length ? <div className="article-empty-state">当前没有匹配的群聊举报。</div> : null}</div>}
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
