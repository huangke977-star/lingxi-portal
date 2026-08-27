"use client";

import {
  ArchiveRestore,
  Ban,
  CircleAlert,
  CircleCheck,
  CloudDownload,
  Download,
  Eye,
  FileQuestion,
  FileWarning,
  Gauge,
  HardDrive,
  History,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import {
  confirmStorageIssueUnrecoverable,
  deleteStorageTrash,
  getStorageIssueFile,
  getStorageOverview,
  getStorageScan,
  listStorageIssueRepairs,
  listStorageIssues,
  listStorageTrash,
  reuploadMissingStorageIssue,
  restoreMissingStorageIssue,
  restoreStorageTrash,
  startStorageScan,
  trashStorageIssue,
  updateStorageConfiguration,
  type StorageCategoryKey,
  type StorageIssue,
  type StorageIssueKind,
  type StorageIssueList,
  type StorageFileRepair,
  type StorageManagementConfiguration,
  type StorageOverview,
  type StorageTrashList,
} from "@/lib/system-status-api";

type StorageTab = "issues" | "trash" | "settings";

const CATEGORY_OPTIONS: Array<{ value: StorageCategoryKey | ""; chinese: string; english: string }> = [
  { value: "", chinese: "全部分类", english: "All categories" },
  { value: "backgrounds", chinese: "背景图片", english: "Background images" },
  { value: "site-assets", chinese: "站点资源", english: "Site assets" },
  { value: "android-releases", chinese: "Android 安装包", english: "Android packages" },
  { value: "avatars", chinese: "用户头像", english: "User avatars" },
  { value: "articles", chinese: "文章媒体", english: "Article media" },
  { value: "chat", chinese: "聊天附件", english: "Chat attachments" },
];

const ISSUE_OPTIONS: Array<{ value: StorageIssueKind | ""; chinese: string; english: string }> = [
  { value: "", chinese: "全部异常", english: "All issues" },
  { value: "missing", chinese: "文件缺失", english: "Missing files" },
  { value: "orphan", chinese: "孤立文件", english: "Orphan files" },
  { value: "metadata_mismatch", chinese: "大小不一致", english: "Size mismatch" },
];

type Phrase = (chinese: string, english: string) => string;

export default function StorageManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [issues, setIssues] = useState<StorageIssueList | null>(null);
  const [trash, setTrash] = useState<StorageTrashList | null>(null);
  const [tab, setTab] = useState<StorageTab>("issues");
  const [issueKind, setIssueKind] = useState<StorageIssueKind | "">("");
  const [category, setCategory] = useState<StorageCategoryKey | "">("");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [issuePage, setIssuePage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const [configuration, setConfiguration] = useState<StorageManagementConfiguration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [unrecoverableTarget, setUnrecoverableTarget] = useState<StorageIssue | null>(null);
  const [unrecoverableNote, setUnrecoverableNote] = useState("");
  const [repairHistory, setRepairHistory] = useState<{ issue: StorageIssue; items: StorageFileRepair[] } | null>(null);

  const handleError = useCallback((loadError: unknown, fallback: string) => {
    if (isAuthExpiredError(loadError)) {
      clearAuthTokens();
      router.replace(localizedPath("/", locale));
      return;
    }
    setError(loadError instanceof Error ? loadError.message : fallback);
  }, [locale, router]);

  const loadOverview = useCallback(async (token: string) => {
    const next = await getStorageOverview(token);
    setOverview(next);
    setConfiguration(next.configuration);
    setIsScanning(next.latestScan?.status === "running");
    return next;
  }, []);

  const loadIssues = useCallback(async (token: string, page = issuePage) => {
    setIssues(await listStorageIssues(token, {
      page,
      pageSize: 20,
      kind: issueKind,
      category,
      q: searchQuery,
    }));
  }, [category, issueKind, issuePage, searchQuery]);

  const loadTrash = useCallback(async (token: string, page = trashPage) => {
    setTrash(await listStorageTrash(token, { page, pageSize: 20, category }));
  }, [category, trashPage]);

  const loadInitial = useCallback(async (token: string) => {
    const [nextOverview, nextIssues, nextTrash] = await Promise.all([
      getStorageOverview(token),
      listStorageIssues(token, { page: 1, pageSize: 20 }),
      listStorageTrash(token, { page: 1, pageSize: 20 }),
    ]);
    setOverview(nextOverview);
    setConfiguration(nextOverview.configuration);
    setIsScanning(nextOverview.latestScan?.status === "running");
    setIssues(nextIssues);
    setTrash(nextTrash);
  }, []);

  const refreshAll = useCallback(async (token: string) => {
    await Promise.all([loadOverview(token), loadIssues(token), loadTrash(token)]);
  }, [loadIssues, loadOverview, loadTrash]);

  useEffect(() => {
    let active = true;
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    void getMe(token)
      .then(async (user) => {
        if (!active) return;
        setAccessToken(token);
        setCurrentUser(user);
        if (user.isSuperAdmin) await loadInitial(token);
      })
      .catch((loadError: unknown) => handleError(loadError, phrase("无法验证访问权限。", "Could not verify access.")))
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [handleError, loadInitial, locale, phrase, router]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin || isLoading) return;
    const timer = window.setTimeout(() => {
      void loadIssues(accessToken).catch((loadError) => handleError(loadError, phrase("异常文件读取失败。", "Could not load storage issues.")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accessToken, currentUser, handleError, isLoading, loadIssues, phrase]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin || isLoading) return;
    const timer = window.setTimeout(() => {
      void loadTrash(accessToken).catch((loadError) => handleError(loadError, phrase("回收站读取失败。", "Could not load the recycle bin.")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accessToken, currentUser, handleError, isLoading, loadTrash, phrase]);

  useEffect(() => {
    if (!accessToken || !overview?.latestScan || overview.latestScan.status !== "running") return;
    const scanId = overview.latestScan.id;
    const timer = window.setInterval(() => {
      void getStorageScan(accessToken, scanId)
        .then(async (scan) => {
          if (scan.status === "running") return;
          window.clearInterval(timer);
          setIsScanning(false);
          await refreshAll(accessToken);
          setNotice(scan.status === "completed" ? phrase("存储扫描已完成。", "Storage scan completed.") : scan.error || phrase("存储扫描失败。", "Storage scan failed."));
        })
        .catch((loadError) => handleError(loadError, phrase("扫描状态读取失败。", "Could not load scan status.")));
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [accessToken, handleError, overview?.latestScan, phrase, refreshAll]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const summary = overview?.latestScan?.summary ?? null;
  const issueCountLabel = useMemo(() => `${overview?.openIssues.total ?? 0}`, [overview]);

  async function handleStartScan() {
    if (!accessToken || isScanning) return;
    setIsScanning(true);
    setError("");
    try {
      const scan = await startStorageScan(accessToken);
      setOverview((current) => current ? { ...current, latestScan: scan } : current);
      setNotice(phrase("存储扫描已开始。", "Storage scan started."));
    } catch (actionError) {
      setIsScanning(false);
      handleError(actionError, phrase("无法启动存储扫描。", "Could not start the storage scan."));
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssuePage(1);
    setSearchQuery(searchText.trim());
  }

  async function handleFile(issue: StorageIssue, download: boolean) {
    if (!accessToken || busyAction) return;
    setBusyAction(`file:${issue.id}`);
    setError("");
    try {
      const blob = await getStorageIssueFile(accessToken, issue.id);
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = issue.storedName.split("/").at(-1) || "storage-file";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(phrase("文件下载已开始。", "File download started."));
      } else {
        if (preview) URL.revokeObjectURL(preview.url);
        setPreview({ name: issue.storedName, url });
      }
    } catch (actionError) {
      handleError(actionError, phrase("文件读取失败。", "Could not load the file."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleTrashIssue(issue: StorageIssue) {
    if (!accessToken || busyAction || !(await confirm(phrase(`将 ${issue.storedName} 移入回收站吗？`, `Move ${issue.storedName} to the recycle bin?`), { danger: true }))) return;
    setBusyAction(`trash:${issue.id}`);
    setError("");
    try {
      await trashStorageIssue(accessToken, issue.id);
      await refreshAll(accessToken);
      setNotice(phrase("孤立文件已移入回收站。", "Orphan file moved to the recycle bin."));
    } catch (actionError) {
      handleError(actionError, phrase("文件移入回收站失败。", "Could not move the file to the recycle bin."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleRemoteRestore(issue: StorageIssue) {
    if (!accessToken || busyAction || !(await confirm(phrase(`从远端备份恢复 ${issue.storedName} 吗？`, `Restore ${issue.storedName} from remote backup?`)))) return;
    setBusyAction(`remote:${issue.id}`);
    setError("");
    try {
      await restoreMissingStorageIssue(accessToken, issue.id);
      await refreshAll(accessToken);
      setNotice(phrase("文件已从远端备份恢复并通过校验。", "File restored from remote backup and verified."));
    } catch (actionError) {
      handleError(actionError, phrase("远端恢复失败。", "Remote restore failed."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleReplacementUpload(issue: StorageIssue, file: File | undefined) {
    if (!accessToken || !file || busyAction) return;
    setBusyAction(`reupload:${issue.id}`);
    setError("");
    try {
      await reuploadMissingStorageIssue(accessToken, issue.id, file);
      await refreshAll(accessToken);
      setNotice(phrase("替换文件已上传并写回原位置。", "Replacement file uploaded and restored to its original location."));
    } catch (actionError) {
      handleError(actionError, phrase("替换文件上传失败。", "Could not upload the replacement file."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleConfirmUnrecoverable() {
    if (!accessToken || !unrecoverableTarget || busyAction) return;
    setBusyAction(`unrecoverable:${unrecoverableTarget.id}`);
    setError("");
    try {
      await confirmStorageIssueUnrecoverable(accessToken, unrecoverableTarget.id, unrecoverableNote.trim());
      setUnrecoverableTarget(null);
      setUnrecoverableNote("");
      await refreshAll(accessToken);
      setNotice(phrase("已记录为无法恢复，后续扫描不会重复列为待处理项。", "Marked as unrecoverable. Future scans will not list it as pending again."));
    } catch (actionError) {
      handleError(actionError, phrase("无法保存处理结果。", "Could not save the handling result."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleRepairHistory(issue: StorageIssue) {
    if (!accessToken || busyAction) return;
    setBusyAction(`history:${issue.id}`);
    setError("");
    try {
      setRepairHistory({ issue, items: await listStorageIssueRepairs(accessToken, issue.id) });
    } catch (actionError) {
      handleError(actionError, phrase("修复记录读取失败。", "Could not load repair history."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleRestore(id: number) {
    if (!accessToken || busyAction) return;
    setBusyAction(`restore:${id}`);
    setError("");
    try {
      await restoreStorageTrash(accessToken, id);
      await refreshAll(accessToken);
      setNotice(phrase("文件已恢复到原位置，请重新扫描确认状态。", "File restored to its original location. Scan again to confirm its status."));
    } catch (actionError) {
      handleError(actionError, phrase("文件恢复失败。", "Could not restore the file."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteTrash(id: number, name: string) {
    if (!accessToken || busyAction || !(await confirm(phrase(`永久删除 ${name} 吗？该操作无法撤销。`, `Permanently delete ${name}? This cannot be undone.`), { danger: true }))) return;
    setBusyAction(`delete:${id}`);
    setError("");
    try {
      await deleteStorageTrash(accessToken, id);
      await Promise.all([loadOverview(accessToken), loadTrash(accessToken)]);
      setNotice(phrase("回收站文件已永久删除。", "Recycle-bin file permanently deleted."));
    } catch (actionError) {
      handleError(actionError, phrase("文件删除失败。", "Could not delete the file."));
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !configuration || busyAction) return;
    setBusyAction("configuration");
    setError("");
    try {
      const saved = await updateStorageConfiguration(accessToken, configuration);
      setConfiguration(saved);
      setOverview((current) => current ? { ...current, configuration: saved } : current);
      setNotice(phrase("存储策略已保存。", "Storage policy saved."));
    } catch (actionError) {
      handleError(actionError, phrase("存储策略保存失败。", "Could not save the storage policy."));
    } finally {
      setBusyAction("");
    }
  }

  const pageDescription = phrase("检查上传文件完整性并维护存储空间。", "Check uploaded-file integrity and maintain storage.");

  if (isLoading) return <AdminPageLoading className="storage-management-shell" description={pageDescription} loadingLabel={phrase("正在读取存储状态", "Loading storage status")} title={phrase("存储管理", "Storage management")} />;

  if (!currentUser?.isSuperAdmin) {
    return <section className="page-shell admin-shell storage-management-shell"><h1>{phrase("无权访问", "Access denied")}</h1><p>{phrase("存储管理仅超级管理员可以查看。", "Only super administrators can view storage management.")}</p><Link className="text-action primary" href={localizedPath("/", locale)}>{phrase("返回首页", "Back to home")}</Link></section>;
  }

  return <section className="page-shell admin-shell storage-management-shell">
    <AppToast duration={error ? 4200 : 3200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    <AdminPageHeader className="storage-management-head" description={pageDescription} title={phrase("存储管理", "Storage management")} actions={<div className="storage-management-head-actions">
        {overview?.latestScan ? <small>{phrase("最近扫描 ", "Last scan ")}{formatDateTime(overview.latestScan.completedAt || overview.latestScan.startedAt, locale)}</small> : <small>{phrase("尚未扫描", "Not scanned yet")}</small>}
        <button aria-label={phrase("立即扫描", "Scan now")} className="admin-header-icon-action" disabled={isScanning} onClick={() => void handleStartScan()} title={phrase("立即扫描", "Scan now")} type="button"><RefreshCcw aria-hidden="true" className={isScanning ? "spin" : ""} size={16} /></button>
      </div>} />

    <div className="storage-health-strip">
      <StorageMetric icon={Gauge} label={phrase("磁盘使用", "Disk usage")} tone={diskTone(summary?.disk.usedPercent, overview?.configuration.warningThresholdPercent)} value={summary?.disk.usedPercent === null || summary?.disk.usedPercent === undefined ? phrase("未读取", "Not available") : `${summary.disk.usedPercent}%`} detail={summary?.disk.availableBytes === null || summary?.disk.availableBytes === undefined ? phrase("等待扫描", "Waiting for scan") : phrase(`可用 ${formatBytes(summary.disk.availableBytes)}`, `${formatBytes(summary.disk.availableBytes)} available`)} />
      <StorageMetric icon={CircleCheck} label={phrase("健康文件", "Healthy files")} tone="ok" value={`${summary?.healthyCount ?? 0}`} detail={phrase("数据库记录与磁盘文件一致", "Database records match disk files")} />
      <StorageMetric icon={FileWarning} label={phrase("文件缺失", "Missing files")} tone={(overview?.openIssues.missing ?? 0) ? "error" : "ok"} value={`${overview?.openIssues.missing ?? 0}`} detail={phrase("数据库有记录，磁盘无文件", "Database record exists but file is missing") } />
      <StorageMetric icon={FileQuestion} label={phrase("孤立文件", "Orphan files")} tone={(overview?.openIssues.orphan ?? 0) ? "warning" : "ok"} value={`${overview?.openIssues.orphan ?? 0}`} detail={phrase("磁盘有文件，数据库无记录", "Disk file exists but has no database record")} />
      <StorageMetric icon={Trash2} label={phrase("回收站", "Recycle bin")} tone={(overview?.trash.expiredCount ?? 0) ? "warning" : "neutral"} value={`${overview?.trash.count ?? 0}`} detail={formatBytes(overview?.trash.sizeBytes ?? 0)} />
    </div>

    <nav className="storage-management-tabs" aria-label={phrase("存储管理视图", "Storage management views")}>
      <button className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")} type="button">{phrase("异常文件", "Issues")} <b>{issueCountLabel}</b></button>
      <button className={tab === "trash" ? "active" : ""} onClick={() => setTab("trash")} type="button">{phrase("回收站", "Recycle bin")} <b>{overview?.trash.count ?? 0}</b></button>
      <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")} type="button">{phrase("扫描策略", "Scan policy")}</button>
    </nav>

    {tab === "issues" ? <section className="storage-management-panel">
      <div className="storage-filter-row">
        <form onSubmit={handleSearch}><Search aria-hidden="true" size={15} /><input onChange={(event) => setSearchText(event.target.value)} placeholder={phrase("搜索文件名、来源或上传账号", "Search file name, source, or uploader")} value={searchText} /><button type="submit">{phrase("搜索", "Search")}</button></form>
        <GlassSelect ariaLabel={phrase("异常类型", "Issue type")} onChange={(value) => { setIssuePage(1); setIssueKind(value as StorageIssueKind | ""); }} options={ISSUE_OPTIONS.map((item) => ({ value: item.value, label: phrase(item.chinese, item.english) }))} value={issueKind} />
        <GlassSelect ariaLabel={phrase("文件分类", "File category")} onChange={(value) => { setIssuePage(1); setCategory(value as StorageCategoryKey | ""); }} options={CATEGORY_OPTIONS.map((item) => ({ value: item.value, label: phrase(item.chinese, item.english) }))} value={category} />
      </div>
      <div className="storage-issue-list">
        {issues?.items.map((issue) => <article className={`storage-issue-row ${issue.kind}`} key={issue.id}>
          <span className="storage-issue-symbol">{issue.kind === "missing" ? <FileWarning aria-hidden="true" size={18} /> : issue.kind === "orphan" ? <FileQuestion aria-hidden="true" size={18} /> : <CircleAlert aria-hidden="true" size={18} />}</span>
          <div className="storage-issue-main"><span><em>{issueLabel(issue.kind, phrase)}</em><small>{issue.categoryLabel}</small></span><strong title={issue.storedName}>{issue.storedName}</strong><p title={issue.sourceLabel}>{issue.sourceLabel}</p><footer>{issue.uploadedBy ? <span>{phrase("上传：", "Uploaded by: ")}{issue.uploadedBy}</span> : null}<span>{formatIssueSize(issue, phrase)}</span>{issue.fileUpdatedAt ? <span>{formatDateTime(issue.fileUpdatedAt, locale)}</span> : null}</footer></div>
          <div className="storage-issue-actions">
            {issue.sourceUrl ? <Link aria-label={phrase("定位来源", "Open source")} href={issue.sourceUrl} title={phrase("定位来源", "Open source")}><Search aria-hidden="true" size={15} /></Link> : null}
            {issue.previewable ? <button aria-label={phrase("预览文件", "Preview file")} disabled={Boolean(busyAction)} onClick={() => void handleFile(issue, false)} title={phrase("预览", "Preview")} type="button"><Eye aria-hidden="true" size={15} /></button> : null}
            {issue.kind === "orphan" ? <button aria-label={phrase("下载文件", "Download file")} disabled={Boolean(busyAction)} onClick={() => void handleFile(issue, true)} title={phrase("下载", "Download")} type="button"><Download aria-hidden="true" size={15} /></button> : null}
            {issue.kind === "missing" ? <button aria-label={phrase("从远端备份恢复", "Restore from remote backup")} disabled={Boolean(busyAction)} onClick={() => void handleRemoteRestore(issue)} title={phrase("远端恢复", "Remote restore")} type="button"><CloudDownload aria-hidden="true" size={15} /></button> : null}
            {issue.kind === "missing" ? <label aria-label={phrase("重新上传文件", "Re-upload file")} className="storage-repair-upload" title={phrase("重新上传", "Re-upload")}><Upload aria-hidden="true" size={15} /><input disabled={Boolean(busyAction)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleReplacementUpload(issue, file); }} type="file" /></label> : null}
            {issue.kind === "missing" ? <button aria-label={phrase("确认无法恢复", "Mark unrecoverable")} className="danger" disabled={Boolean(busyAction)} onClick={() => { setUnrecoverableTarget(issue); setUnrecoverableNote(""); }} title={phrase("确认无法恢复", "Mark unrecoverable")} type="button"><Ban aria-hidden="true" size={15} /></button> : null}
            {issue.kind === "missing" ? <button aria-label={phrase("查看修复记录", "View repair history")} disabled={Boolean(busyAction)} onClick={() => void handleRepairHistory(issue)} title={phrase("修复记录", "Repair history")} type="button"><History aria-hidden="true" size={15} /></button> : null}
            {issue.canTrash ? <button aria-label={phrase("移入回收站", "Move to recycle bin")} className="danger" disabled={Boolean(busyAction)} onClick={() => void handleTrashIssue(issue)} title={phrase("移入回收站", "Move to recycle bin")} type="button"><Trash2 aria-hidden="true" size={15} /></button> : null}
          </div>
        </article>)}
        {!issues?.items.length ? <div className="storage-empty-state"><ShieldCheck aria-hidden="true" size={22} /><span>{overview?.latestScan ? phrase("当前筛选条件下没有异常文件。", "No storage issues match the current filters.") : phrase("请先执行一次存储扫描。", "Run a storage scan first.")}</span></div> : null}
      </div>
      <Pagination page={issues?.page ?? 1} pageCount={issues?.pageCount ?? 0} onChange={(page) => setIssuePage(page)} phrase={phrase} />
    </section> : null}

    {tab === "trash" ? <section className="storage-management-panel">
      <div className="storage-filter-row compact"><span>{phrase(`共 ${trash?.total ?? 0} 个文件`, `${trash?.total ?? 0} files total`)}</span><GlassSelect ariaLabel={phrase("文件分类", "File category")} onChange={(value) => { setTrashPage(1); setCategory(value as StorageCategoryKey | ""); }} options={CATEGORY_OPTIONS.map((item) => ({ value: item.value, label: phrase(item.chinese, item.english) }))} value={category} /></div>
      <div className="storage-trash-list">
        {trash?.items.map((item) => <article className="storage-trash-row" key={item.id}><span><Trash2 aria-hidden="true" size={17} /></span><div><strong title={item.originalStoredName}>{item.originalStoredName}</strong><small>{item.categoryLabel} · {formatBytes(item.sizeBytes)}</small><p>{phrase("移入 ", "Moved ")}{formatDateTime(item.deletedAt, locale)} · {phrase("自动清理 ", "Auto purge ")}{formatDateTime(item.purgeAfter, locale)}</p></div><footer><button aria-label={phrase("恢复文件", "Restore file")} disabled={Boolean(busyAction)} onClick={() => void handleRestore(item.id)} title={phrase("恢复", "Restore")} type="button"><ArchiveRestore aria-hidden="true" size={15} /></button><button aria-label={phrase("永久删除文件", "Permanently delete file")} className="danger" disabled={Boolean(busyAction)} onClick={() => void handleDeleteTrash(item.id, item.originalStoredName)} title={phrase("永久删除", "Delete permanently")} type="button"><Trash2 aria-hidden="true" size={15} /></button></footer></article>)}
        {!trash?.items.length ? <div className="storage-empty-state"><CircleCheck aria-hidden="true" size={22} /><span>{phrase("回收站为空。", "Recycle bin is empty.")}</span></div> : null}
      </div>
      <Pagination page={trash?.page ?? 1} pageCount={trash?.pageCount ?? 0} onChange={(page) => setTrashPage(page)} phrase={phrase} />
    </section> : null}

    {tab === "settings" && configuration ? <section className="storage-management-panel storage-policy-panel">
      <header><Settings2 aria-hidden="true" size={18} /><strong>{phrase("扫描与清理策略", "Scan and cleanup policy")}</strong></header>
      <form onSubmit={(event) => void handleSaveConfiguration(event)}>
        <label className="storage-policy-toggle"><input checked={configuration.automaticScanEnabled} onChange={(event) => setConfiguration({ ...configuration, automaticScanEnabled: event.target.checked })} type="checkbox" /><span><strong>{phrase("每日自动扫描", "Daily automatic scan")}</strong><small>{configuration.nextRunAt ? phrase(`下次执行 ${formatDateTime(configuration.nextRunAt, locale)}`, `Next run ${formatDateTime(configuration.nextRunAt, locale)}`) : phrase("当前已停用", "Currently disabled")}</small></span></label>
        <label><span>{phrase("执行时间", "Run time")}</span><input onChange={(event) => setConfiguration({ ...configuration, scanTime: event.target.value })} type="time" value={configuration.scanTime} /></label>
        <label><span>{phrase("回收站保留", "Recycle-bin retention")}</span><span className="storage-number-field"><input max={90} min={1} onChange={(event) => setConfiguration({ ...configuration, trashRetentionDays: Number(event.target.value) })} type="number" value={configuration.trashRetentionDays} /><em>{phrase("天", "days")}</em></span></label>
        <label><span>{phrase("磁盘预警阈值", "Disk warning threshold")}</span><span className="storage-number-field"><input max={95} min={50} onChange={(event) => setConfiguration({ ...configuration, warningThresholdPercent: Number(event.target.value) })} type="number" value={configuration.warningThresholdPercent} /><em>%</em></span></label>
        <button disabled={busyAction === "configuration"} type="submit"><Save aria-hidden="true" size={15} />{busyAction === "configuration" ? phrase("保存中", "Saving") : phrase("保存策略", "Save policy")}</button>
      </form>
      <div className="storage-policy-status"><span><small>{phrase("最近扫描", "Latest scan")}</small><strong>{configuration.lastScanAt ? formatDateTime(configuration.lastScanAt, locale) : phrase("暂无", "None")}</strong></span><span><small>{phrase("最近预警", "Latest warning")}</small><strong>{configuration.lastWarningAt ? formatDateTime(configuration.lastWarningAt, locale) : phrase("无", "None")}</strong></span><span><small>{phrase("扫描时区", "Scan time zone")}</small><strong>{configuration.timezone}</strong></span></div>
    </section> : null}

    {preview ? <div className="storage-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { URL.revokeObjectURL(preview.url); setPreview(null); } }} role="presentation"><div aria-modal="true" className="storage-preview-panel" role="dialog"><button aria-label={phrase("关闭预览", "Close preview")} onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={19} /></button><Image alt={preview.name} height={800} src={preview.url} unoptimized width={1200} /><strong title={preview.name}>{preview.name}</strong></div></div> : null}
    {unrecoverableTarget ? <div className="modal-backdrop modal-backdrop--light" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyAction) setUnrecoverableTarget(null); }} role="presentation"><div aria-modal="true" className="modal-panel storage-repair-modal" role="dialog"><header><span><small>Missing file</small><h2>{phrase("确认无法恢复", "Mark unrecoverable")}</h2></span><button aria-label={phrase("关闭", "Close")} disabled={Boolean(busyAction)} onClick={() => setUnrecoverableTarget(null)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={18} /></button></header><p title={unrecoverableTarget.storedName}>{unrecoverableTarget.storedName}</p><label><span>{phrase("处理说明（可选）", "Handling note (optional)")}</span><textarea maxLength={500} onChange={(event) => setUnrecoverableNote(event.target.value)} placeholder={phrase("例如：原始文件和远端备份均无法取得", "For example: neither the original file nor its remote backup is available")} rows={3} value={unrecoverableNote} /></label><footer><button className="button" disabled={Boolean(busyAction)} onClick={() => void handleConfirmUnrecoverable()} type="button">{busyAction ? phrase("处理中", "Processing") : phrase("确认记录", "Confirm record")}</button><button className="button secondary" disabled={Boolean(busyAction)} onClick={() => setUnrecoverableTarget(null)} type="button">{phrase("取消", "Cancel")}</button></footer></div></div> : null}
    {repairHistory ? <div className="modal-backdrop modal-backdrop--light" onMouseDown={(event) => { if (event.target === event.currentTarget) setRepairHistory(null); }} role="presentation"><div aria-modal="true" className="modal-panel storage-repair-history-modal" role="dialog"><header><span><small>Repair history</small><h2>{phrase("文件修复记录", "File repair history")}</h2></span><button aria-label={phrase("关闭", "Close")} onClick={() => setRepairHistory(null)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={18} /></button></header><p title={repairHistory.issue.storedName}>{repairHistory.issue.storedName}</p><div>{repairHistory.items.map((repair) => <article className={repair.status} key={repair.id}><span><strong>{repairActionLabel(repair.action, phrase)}</strong><small>{formatDateTime(repair.completedAt || repair.startedAt, locale)}</small></span><i>{repairStatusLabel(repair.status, phrase)}</i>{repair.error || repair.note ? <p>{repair.error || repair.note}</p> : null}</article>)}{!repairHistory.items.length ? <div className="storage-empty-state"><History aria-hidden="true" size={20} /><span>{phrase("暂无修复记录。", "No repair history.")}</span></div> : null}</div></div></div> : null}
  </section>;
}

function StorageMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof HardDrive; label: string; value: string; detail: string; tone: "ok" | "error" | "warning" | "neutral" }) {
  return <div className={`storage-health-metric ${tone}`}><span><Icon aria-hidden="true" size={18} /></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function Pagination({ page, pageCount, onChange, phrase }: { page: number; pageCount: number; onChange: (page: number) => void; phrase: Phrase }) {
  if (pageCount <= 1) return null;
  return <div className="storage-pagination"><button disabled={page <= 1} onClick={() => onChange(page - 1)} type="button">{phrase("上一页", "Previous")}</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => onChange(page + 1)} type="button">{phrase("下一页", "Next")}</button></div>;
}

function issueLabel(kind: StorageIssueKind, phrase: Phrase): string {
  if (kind === "missing") return phrase("文件缺失", "Missing file");
  if (kind === "orphan") return phrase("孤立文件", "Orphan file");
  return phrase("大小不一致", "Size mismatch");
}

function repairActionLabel(action: StorageFileRepair["action"], phrase: Phrase): string {
  return ({
    remote_restore: phrase("远端恢复", "Remote restore"),
    reupload: phrase("重新上传", "Re-upload"),
    confirm_unrecoverable: phrase("确认无法恢复", "Marked unrecoverable"),
  })[action];
}

function repairStatusLabel(status: StorageFileRepair["status"], phrase: Phrase): string {
  return ({ running: phrase("处理中", "Processing"), completed: phrase("已完成", "Completed"), failed: phrase("失败", "Failed") })[status];
}

function formatIssueSize(issue: StorageIssue, phrase: Phrase): string {
  if (issue.kind === "metadata_mismatch") return phrase(`${formatBytes(issue.expectedSizeBytes ?? 0)} / 实际 ${formatBytes(issue.actualSizeBytes ?? 0)}`, `${formatBytes(issue.expectedSizeBytes ?? 0)} / actual ${formatBytes(issue.actualSizeBytes ?? 0)}`);
  return formatBytes(issue.actualSizeBytes ?? issue.expectedSizeBytes ?? 0);
}

function diskTone(value: number | null | undefined, threshold = 75): "ok" | "warning" | "error" | "neutral" {
  if (value === null || value === undefined) return "neutral";
  if (value >= Math.min(95, threshold + 15)) return "error";
  if (value >= threshold) return "warning";
  return "ok";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
