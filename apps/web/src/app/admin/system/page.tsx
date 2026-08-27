"use client";

import {
  Activity,
  Archive,
  ArchiveRestore,
  Box,
  CircleAlert,
  CircleCheck,
  Cloud,
  CloudCog,
  CloudUpload,
  Clock3,
  Database,
  Download,
  Files,
  HardDrive,
  KeyRound,
  ListChecks,
  RefreshCcw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { containerRuntimeMessage, mediaBackupLogMessage, storageCategoryLabel } from "@/lib/system-labels";
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  downloadDatabaseBackup,
  getBackupConfiguration,
  getBackupRestorePreflight,
  getMediaBackupJob,
  getStorageOverview,
  getSystemStatus,
  listMediaBackupJobs,
  restoreDatabaseBackup,
  startMediaBackup,
  testBackupProvider,
  updateBackupConfiguration,
  verifyDatabaseBackup,
  type BackupConfiguration,
  type BackupConfigurationUpdate,
  type BackupRestorePreflight,
  type MediaBackupJob,
  type MediaBackupJobDetail,
  type StorageOverview,
  type SystemStatus,
} from "@/lib/system-status-api";

interface BackupConfigurationForm extends BackupConfigurationUpdate {
  ossAccessKeyId: string;
  ossAccessKeySecret: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
}

type Phrase = (chinese: string, english: string) => string;

export default function SystemStatusPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [storageOverview, setStorageOverview] = useState<StorageOverview | null>(null);
  const [backupConfiguration, setBackupConfiguration] = useState<BackupConfiguration | null>(null);
  const [backupForm, setBackupForm] = useState<BackupConfigurationForm | null>(null);
  const [mediaJobs, setMediaJobs] = useState<MediaBackupJob[]>([]);
  const [selectedMediaJob, setSelectedMediaJob] = useState<MediaBackupJobDetail | null>(null);
  const [mediaBusy, setMediaBusy] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backupBusy, setBackupBusy] = useState("");
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [providerTesting, setProviderTesting] = useState<"oss" | "r2" | "">("");
  const [restoreTarget, setRestoreTarget] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restorePreflight, setRestorePreflight] = useState<BackupRestorePreflight | null>(null);
  const [postRestoreStorageScanId, setPostRestoreStorageScanId] = useState<number | null>(null);

  const loadStatus = useCallback(async (token: string, refresh = false) => {
    if (refresh) setIsRefreshing(true);
    setError("");
    try {
      setStatus(await getSystemStatus(token));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(loadError instanceof Error ? loadError.message : phrase("系统状态读取失败。", "Could not load system status."));
    } finally {
      if (refresh) setIsRefreshing(false);
    }
  }, [locale, phrase, router]);

  const loadBackupConfiguration = useCallback(async (token: string) => {
    const configuration = await getBackupConfiguration(token);
    setBackupConfiguration(configuration);
    setBackupForm(toBackupConfigurationForm(configuration));
  }, []);

  const loadStorageOverview = useCallback(async (token: string) => {
    setStorageOverview(await getStorageOverview(token));
  }, []);

  const loadMediaJobs = useCallback(async (token: string) => {
    const result = await listMediaBackupJobs(token, 5);
    setMediaJobs(result.items);
    return result.items;
  }, []);

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
        if (user.isSuperAdmin) await Promise.all([loadStatus(token), loadBackupConfiguration(token), loadStorageOverview(token), loadMediaJobs(token)]);
      })
      .catch((loadError: unknown) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("无法验证访问权限。", "Could not verify access."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [loadBackupConfiguration, loadMediaJobs, loadStatus, loadStorageOverview, locale, phrase, router]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin) return;
    const timer = window.setInterval(() => void Promise.all([loadStatus(accessToken), loadStorageOverview(accessToken), loadMediaJobs(accessToken)]), 30_000);
    return () => window.clearInterval(timer);
  }, [accessToken, currentUser, loadMediaJobs, loadStatus, loadStorageOverview]);

  useEffect(() => {
    if (!accessToken || !mediaJobs.some((job) => job.status === "pending" || job.status === "running")) return;
    const timer = window.setInterval(() => {
      void Promise.all([loadMediaJobs(accessToken), loadStatus(accessToken)]);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [accessToken, loadMediaJobs, loadStatus, mediaJobs]);

  const largestStorageBytes = useMemo(
    () => Math.max(1, ...(status?.storage.items.map((item) => item.sizeBytes) ?? [1])),
    [status],
  );

  async function refreshAfterBackup(message: string) {
    if (!accessToken) return;
    await Promise.all([loadStatus(accessToken), loadBackupConfiguration(accessToken)]);
    setNotice(message);
  }

  async function handleCreateBackup() {
    if (!accessToken || backupBusy) return;
    setBackupBusy("create");
    setError("");
    try {
      const backup = await createDatabaseBackup(accessToken);
      await refreshAfterBackup(backup.warning || phrase(`备份已创建：${backup.name}`, `Backup created: ${backup.name}`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("数据库备份创建失败。", "Could not create the database backup."));
    } finally {
      setBackupBusy("");
    }
  }

  async function handleStartMediaBackup() {
    if (!accessToken || mediaBusy) return;
    setMediaBusy("start");
    setError("");
    try {
      const job = await startMediaBackup(accessToken);
      await loadMediaJobs(accessToken);
      setNotice(phrase(`媒体备份任务 #${job.id} 已开始。`, `Media backup job #${job.id} started.`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("媒体备份启动失败。", "Could not start the media backup."));
    } finally {
      setMediaBusy("");
    }
  }

  async function handleOpenMediaJob(id: number) {
    if (!accessToken || mediaBusy) return;
    setMediaBusy(`detail:${id}`);
    setError("");
    try {
      setSelectedMediaJob(await getMediaBackupJob(accessToken, id));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("媒体备份任务读取失败。", "Could not load the media backup job."));
    } finally {
      setMediaBusy("");
    }
  }

  async function handleSaveBackupConfiguration() {
    if (!accessToken || !backupForm || configurationBusy) return;
    setConfigurationBusy(true);
    setError("");
    try {
      const configuration = await updateBackupConfiguration(accessToken, backupForm);
      setBackupConfiguration(configuration);
      setBackupForm(toBackupConfigurationForm(configuration));
      setNotice(phrase("备份策略已保存。", "Backup policy saved."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("备份策略保存失败。", "Could not save the backup policy."));
    } finally {
      setConfigurationBusy(false);
    }
  }

  async function handleTestBackupProvider(provider: "oss" | "r2") {
    if (!accessToken || providerTesting) return;
    setProviderTesting(provider);
    setError("");
    try {
      await testBackupProvider(accessToken, provider);
      setNotice(phrase(`${provider === "oss" ? "阿里云 OSS" : "Cloudflare R2"} 连接正常。`, `${provider === "oss" ? "Alibaba Cloud OSS" : "Cloudflare R2"} connection is ready.`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("异地备份连接测试失败。", "Remote backup connection test failed."));
    } finally {
      setProviderTesting("");
    }
  }

  async function handleDownloadBackup(name: string) {
    if (!accessToken || backupBusy) return;
    setBackupBusy(`download:${name}`);
    setError("");
    try {
      const blob = await downloadDatabaseBackup(accessToken, name);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(phrase("备份下载已开始。", "Backup download started."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("备份下载失败。", "Could not download the backup."));
    } finally {
      setBackupBusy("");
    }
  }

  async function handleDeleteBackup(name: string) {
    if (!accessToken || backupBusy || !(await confirm(phrase(`永久删除备份 ${name} 吗？`, `Permanently delete backup ${name}?`), { danger: true }))) return;
    setBackupBusy(`delete:${name}`);
    setError("");
    try {
      await deleteDatabaseBackup(accessToken, name);
      await refreshAfterBackup(phrase("备份文件已删除。", "Backup file deleted."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("备份删除失败。", "Could not delete the backup."));
    } finally {
      setBackupBusy("");
    }
  }

  async function handleVerifyBackup(name: string) {
    if (!accessToken || backupBusy) return;
    setBackupBusy(`verify:${name}`);
    setError("");
    try {
      const backup = await verifyDatabaseBackup(accessToken, name);
      await loadStatus(accessToken);
      setNotice(backup.verification.status === "failed" ? phrase("备份校验失败，请勿用于恢复。", "Backup verification failed. Do not use it for recovery.") : phrase(`备份校验完成：${backup.name}`, `Backup verification completed: ${backup.name}`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("备份校验失败。", "Backup verification failed."));
    } finally {
      setBackupBusy("");
    }
  }

  async function handleOpenRestoreBackup(name: string) {
    if (!accessToken || backupBusy) return;
    setRestoreTarget(name);
    setRestoreConfirmation("");
    setRestorePreflight(null);
    setBackupBusy(`preflight:${name}`);
    setError("");
    try {
      const preflight = await getBackupRestorePreflight(accessToken, name);
      setRestorePreflight(preflight);
      await loadStatus(accessToken);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("恢复前校验失败。", "Pre-restore verification failed."));
    } finally {
      setBackupBusy("");
    }
  }

  async function handleRestoreBackup() {
    if (!accessToken || !restoreTarget || !restorePreflight?.canRestore || restoreConfirmation !== restoreTarget || backupBusy) return;
    setBackupBusy(`restore:${restoreTarget}`);
    setError("");
    try {
      const restored = await restoreDatabaseBackup(accessToken, restoreTarget);
      setRestoreTarget("");
      setRestoreConfirmation("");
      setRestorePreflight(null);
      setPostRestoreStorageScanId(restored.storageScanId);
      await refreshAfterBackup(restored.warning || phrase(`数据库与媒体文件已恢复，恢复前备份：${restored.safetyBackup.name}`, `Database and media restored. Pre-restore backup: ${restored.safetyBackup.name}`));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("数据库恢复失败。", "Database restore failed."));
    } finally {
      setBackupBusy("");
    }
  }

  const pageDescription = phrase("查看应用、数据库、缓存和备份运行状态。", "Monitor application, database, cache, and backup status.");

  if (isLoading) return <AdminPageLoading className="system-status-shell" description={pageDescription} loadingLabel={phrase("正在读取系统状态", "Loading system status")} title={phrase("系统运行概览", "System overview")} />;

  if (!currentUser?.isSuperAdmin) {
    return <section className="page-shell admin-shell system-status-shell">
      <h1>{phrase("无权访问", "Access denied")}</h1>
      <p>{phrase("系统运行概览仅超级管理员可以查看。", "Only super administrators can view the system overview.")}</p>
      <Link className="text-action primary" href={localizedPath("/", locale)}>{phrase("返回首页", "Back to home")}</Link>
    </section>;
  }

  return <section className="page-shell admin-shell system-status-shell">
    <AppToast duration={error ? 4200 : 3200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    <AdminPageHeader className="system-status-head" description={pageDescription} title={phrase("系统运行概览", "System overview")} actions={<div className="system-status-head-actions">
        {status ? <small>{phrase("更新于 ", "Updated ")}{formatDateTime(status.generatedAt, locale)}</small> : null}
        <button aria-label={phrase("刷新系统状态", "Refresh system status")} className="admin-header-icon-action" disabled={isRefreshing || !accessToken} onClick={() => accessToken && void Promise.all([loadStatus(accessToken, true), loadStorageOverview(accessToken), loadMediaJobs(accessToken)])} title={phrase("刷新", "Refresh")} type="button">
          <RefreshCcw aria-hidden="true" className={isRefreshing ? "spin" : ""} size={17} />
        </button>
      </div>} />

    {status ? <>
      <div className="system-overview-strip">
        <OverviewItem icon={Activity} label={phrase("API 运行", "API runtime")} value={formatDuration(status.application.uptimeSeconds, phrase)} detail={`RSS ${formatBytes(status.application.memory.rssBytes)}`} tone="ok" />
        <OverviewItem icon={Database} label="MySQL" value={status.database.connected ? phrase("连接正常", "Connected") : phrase("连接异常", "Connection issue")} detail={status.database.connected ? `${status.database.latencyMs ?? 0} ms` : status.database.error ?? phrase("读取失败", "Unavailable")} tone={status.database.connected ? "ok" : "error"} />
        <OverviewItem icon={Server} label="Redis" value={status.redis.connected ? phrase("连接正常", "Connected") : phrase("连接异常", "Connection issue")} detail={status.redis.connected ? phrase(`${status.redis.keyCount ?? 0} 个键`, `${status.redis.keyCount ?? 0} keys`) : status.redis.error ?? phrase("读取失败", "Unavailable")} tone={status.redis.connected ? "ok" : "error"} />
        <OverviewItem icon={Files} label={phrase("文件存储", "File storage")} value={formatBytes(status.storage.totalBytes)} detail={phrase(`${status.storage.totalFiles} 个文件`, `${status.storage.totalFiles} files`)} tone="neutral" />
        <OverviewItem icon={Archive} label={phrase("媒体备份覆盖", "Media backup coverage")} value={formatCoverage(status.reliability.backupCoverage.percentage, phrase)} detail={phrase(`${status.reliability.backupCoverage.backedUpFiles} / ${status.reliability.backupCoverage.totalFiles} 个文件`, `${status.reliability.backupCoverage.backedUpFiles} / ${status.reliability.backupCoverage.totalFiles} files`)} tone={status.reliability.backupCoverage.uncoveredFiles ? "warning" : "ok"} />
        <OverviewItem icon={Clock3} label={phrase("最近备份成功", "Latest backup success")} value={status.reliability.lastSuccessfulBackupAt ? formatDateTime(status.reliability.lastSuccessfulBackupAt, locale) : phrase("暂无成功记录", "No successful backup yet")} valueClassName="datetime" detail={formatBackupSource(status.reliability.lastSuccessfulBackupSource, phrase)} tone={status.reliability.lastSuccessfulBackupAt ? "ok" : "neutral"} />
        <OverviewItem icon={CircleAlert} label={phrase(`近 ${status.reliability.anomalyWindowHours} 小时异常`, `Issues in the last ${status.reliability.anomalyWindowHours} hours`)} value={phrase(`${status.reliability.anomalies.total} 项`, `${status.reliability.anomalies.total} issues`)} detail={formatAnomalySummary(status.reliability.anomalies, phrase)} tone={status.reliability.anomalies.total ? "error" : "ok"} />
      </div>

      <div className="system-status-grid">
        <section className="system-status-panel services">
          <PanelHeading icon={Box} title={phrase("服务状态", "Service status")} />
          <StatusLine label={phrase("API 运行环境", "API runtime")} value={`${status.application.environment} / ${status.application.nodeVersion}`} ok />
          <StatusLine label={phrase("MySQL 版本", "MySQL version")} value={status.database.version ?? phrase("无法读取", "Unavailable")} ok={status.database.connected} />
          <StatusLine label={phrase("数据库容量", "Database size")} value={formatNullableBytes(status.database.sizeBytes, phrase)} ok={status.database.connected} />
          <StatusLine label={phrase("Prisma 迁移", "Prisma migrations")} value={status.database.latestMigration ? phrase(`${status.database.migrationCount ?? 0} 项 · ${status.database.latestMigration.name}`, `${status.database.migrationCount ?? 0} migrations · ${status.database.latestMigration.name}`) : phrase("暂无迁移记录", "No migration records")} ok={status.database.connected} />
          <StatusLine label={phrase("Redis 版本", "Redis version")} value={status.redis.version ?? phrase("无法读取", "Unavailable")} ok={status.redis.connected} />
          <StatusLine label={phrase("Redis 内存", "Redis memory")} value={formatMemoryUsage(status.redis.usedMemoryBytes, status.redis.maxMemoryBytes, phrase)} ok={status.redis.connected} />
        </section>

        <section className="system-status-panel storage">
          <PanelHeading icon={HardDrive} title={phrase("文件存储分布", "File storage distribution")} />
          <div className="system-storage-list">
            {status.storage.items.map((item) => <div className="system-storage-row" key={item.key}>
              <div><strong>{storageCategoryLabel(item.key, locale, item.label)}</strong><span>{item.available ? phrase(`${item.fileCount} 个文件`, `${item.fileCount} files`) : phrase("目录暂不可用", "Directory unavailable")}</span></div>
              <b>{formatBytes(item.sizeBytes)}</b>
              <i><span style={{ width: `${Math.max(item.sizeBytes ? 4 : 0, item.sizeBytes / largestStorageBytes * 100)}%` }} /></i>
            </div>)}
          </div>
          <div className={`system-storage-health-link ${(storageOverview?.openIssues.total ?? 0) ? "warning" : "ok"}`}>
            <span><ShieldCheck aria-hidden="true" size={16} /><small>{storageOverview?.latestScan ? phrase(`${storageOverview.openIssues.total} 项待处理 · ${formatDateTime(storageOverview.latestScan.completedAt || storageOverview.latestScan.startedAt, locale)}`, `${storageOverview.openIssues.total} pending · ${formatDateTime(storageOverview.latestScan.completedAt || storageOverview.latestScan.startedAt, locale)}`) : phrase("尚未执行完整性扫描", "Integrity scan has not run")}</small></span>
            <Link href={localizedPath("/admin/storage", locale)}>{phrase("存储管理", "Storage management")}</Link>
          </div>
        </section>

        <section className="system-status-panel backups">
          <header className="system-panel-heading system-backup-heading"><span><Archive aria-hidden="true" size={17} /><strong>{phrase("数据库备份", "Database backups")}</strong></span><button disabled={Boolean(backupBusy)} onClick={() => void handleCreateBackup()} type="button">{backupBusy === "create" ? phrase("备份中", "Backing up") : phrase("立即备份", "Back up now")}</button></header>
          <div className="system-backup-summary">
            <span><Clock3 aria-hidden="true" size={16} /><small>{phrase("最近备份", "Latest backup")}</small><strong>{status.backups.latest ? formatDateTime(status.backups.latest.updatedAt, locale) : phrase("暂无可见备份", "No visible backups")}</strong></span>
            <span><HardDrive aria-hidden="true" size={16} /><small>{phrase("备份占用", "Backup usage")}</small><strong>{formatBytes(status.backups.totalBytes)}</strong></span>
          </div>
          <div className="system-backup-list">
            {status.backups.items.map((backup) => <div className="system-backup-row" key={backup.name}><span><strong title={backup.name}>{backup.name}</strong><small>{formatDateTime(backup.updatedAt, locale)} · SQL {formatBytes(backup.sizeBytes)} · {backup.mediaSnapshotAvailable ? phrase(`媒体 ${formatBytes(backup.mediaSnapshotSizeBytes ?? 0)}`, `Media ${formatBytes(backup.mediaSnapshotSizeBytes ?? 0)}`) : phrase("仅数据库", "Database only")}</small><i className={`backup-verification ${backup.verification.status}`}>{backupVerificationLabel(backup.verification.status, phrase)}</i></span><b>{formatBytes(backup.sizeBytes + (backup.mediaSnapshotSizeBytes ?? 0))}</b><span className="system-backup-actions"><button aria-label={phrase(`下载 ${backup.name}`, `Download ${backup.name}`)} disabled={Boolean(backupBusy)} onClick={() => void handleDownloadBackup(backup.name)} title={phrase("下载", "Download")} type="button"><Download aria-hidden="true" size={15} /></button><button aria-label={phrase(`校验 ${backup.name}`, `Verify ${backup.name}`)} disabled={Boolean(backupBusy)} onClick={() => void handleVerifyBackup(backup.name)} title={phrase("校验备份", "Verify backup")} type="button"><ShieldCheck aria-hidden="true" size={15} /></button><button aria-label={phrase(`恢复 ${backup.name}`, `Restore ${backup.name}`)} disabled={Boolean(backupBusy)} onClick={() => void handleOpenRestoreBackup(backup.name)} title={phrase("恢复", "Restore")} type="button"><ArchiveRestore aria-hidden="true" size={15} /></button><button aria-label={phrase(`删除 ${backup.name}`, `Delete ${backup.name}`)} disabled={Boolean(backupBusy)} onClick={() => void handleDeleteBackup(backup.name)} title={phrase("删除", "Delete")} type="button"><Trash2 aria-hidden="true" size={15} /></button></span></div>)}
            {!status.backups.items.length ? <p>{status.backups.available ? phrase("备份目录中暂无 SQL 备份文件。", "No SQL backups in the backup directory.") : phrase("备份目录尚未挂载或不可读取。", "Backup directory is not mounted or cannot be read.")}</p> : null}
          </div>
          {postRestoreStorageScanId ? <p className="backup-post-restore-scan"><ShieldCheck aria-hidden="true" size={15} />{phrase("恢复后的附件扫描已启动。", "Post-restore attachment scan started.")}<Link href={localizedPath(`/admin/storage?scan=${postRestoreStorageScanId}`, locale)}>{phrase("查看扫描与修复", "View scan and repairs")}</Link></p> : null}
        </section>

        <section className="system-status-panel media-backups">
          <header className="system-panel-heading system-backup-heading">
            <span><CloudUpload aria-hidden="true" size={17} /><strong>{phrase("媒体文件备份", "Media backups")}</strong></span>
            <button disabled={Boolean(mediaBusy) || mediaJobs.some((job) => job.status === "pending" || job.status === "running")} onClick={() => void handleStartMediaBackup()} type="button">
              {mediaBusy === "start" ? phrase("启动中", "Starting") : mediaJobs.some((job) => job.status === "pending" || job.status === "running") ? phrase("备份中", "Backing up") : phrase("立即备份", "Back up now")}
            </button>
          </header>
          <div className="media-backup-summary">
            <span><small>{phrase("覆盖率", "Coverage")}</small><strong>{formatCoverage(status.reliability.backupCoverage.percentage, phrase)}</strong></span>
            <span><small>{phrase("未备份", "Unbacked")}</small><strong>{phrase(`${status.reliability.backupCoverage.uncoveredFiles} 个文件`, `${status.reliability.backupCoverage.uncoveredFiles} files`)}</strong></span>
            <span><small>{phrase("远端", "Remote")}</small><strong>{backupConfiguration ? enabledProviderLabel(backupConfiguration, phrase) : phrase("读取中", "Loading")}</strong></span>
          </div>
          <div className="media-backup-job-list">
            {mediaJobs.map((job) => <button disabled={Boolean(mediaBusy)} key={job.id} onClick={() => void handleOpenMediaJob(job.id)} type="button">
              <span><i className={mediaJobTone(job.status)}>{mediaJobStatusLabel(job.status, phrase)}</i><strong>{phrase(`任务 #${job.id}`, `Job #${job.id}`)}</strong><small>{formatDateTime(job.completedAt || job.startedAt || job.createdAt, locale)}</small></span>
              <span><b>{job.processedFiles} / {job.totalFiles}</b><small>{phrase(`上传 ${job.uploadedFiles} · 复用 ${job.reusedFiles} · 失败 ${job.failedFiles}`, `Uploaded ${job.uploadedFiles} · Reused ${job.reusedFiles} · Failed ${job.failedFiles}`)}</small></span>
              <ListChecks aria-hidden="true" size={15} />
            </button>)}
            {!mediaJobs.length ? <p>{phrase("还没有媒体备份任务。配置并启用 OSS 或 R2 后可开始首轮备份。", "No media backup jobs yet. Configure and enable OSS or R2 to start the first backup.")}</p> : null}
          </div>
        </section>

        <div className="system-monitoring-left">
          <section className="system-status-panel runtime">
            <PanelHeading icon={Server} title={phrase("容器与宿主机", "Containers and host")} />
            <div className="system-runtime-note"><CircleAlert aria-hidden="true" size={20} /><p>{containerRuntimeMessage(locale, status.containerRuntime.message)}</p></div>
            <div className="system-runtime-links"><span>{phrase("容器启停、CPU、整机内存和磁盘清理由 1Panel 或 SSH 负责。", "Container lifecycle, CPU, host memory, and disk cleanup are managed through 1Panel or SSH.")}</span><Link href={localizedPath("/admin/cache", locale)}>{phrase("查看 Redis 缓存", "View Redis cache")}</Link><Link href={localizedPath("/admin/settings", locale)}>{phrase("查看站点资源", "View site assets")}</Link></div>
          </section>

          <section className="system-status-panel monitoring-events">
            <header className="system-panel-heading system-monitoring-heading"><span><CircleAlert aria-hidden="true" size={17} /><strong>{phrase("接口观察", "API monitoring")}</strong></span><small>{phrase(`慢接口阈值 ${status.monitoring.slowRequestThresholdMs} ms`, `Slow request threshold ${status.monitoring.slowRequestThresholdMs} ms`)}</small></header>
            <MonitoringEventList empty={phrase("最近没有慢接口", "No recent slow requests")} events={status.monitoring.slowRequests.slice(0, 5)} title={phrase("慢接口", "Slow requests")} locale={locale} phrase={phrase} />
            <MonitoringEventList empty={phrase("最近没有 API 5xx 错误", "No recent API 5xx errors")} events={status.monitoring.recentErrors.slice(0, 5)} title={phrase("最近错误", "Recent errors")} locale={locale} phrase={phrase} />
          </section>
        </div>

        <section className="system-status-panel monitoring-trends">
          <header className="system-panel-heading system-monitoring-heading"><span><Activity aria-hidden="true" size={17} /><strong>{phrase("资源趋势", "Resource trends")}</strong></span><small>{phrase("每分钟采样 · 最近 24 小时", "Sampled every minute · Last 24 hours")}</small></header>
          <div className="system-trend-list">
            <TrendChart
              detail={status.monitoring.memoryTrend.length ? phrase(`当前 ${formatBytes(status.monitoring.memoryTrend.at(-1)?.rssBytes ?? 0)}`, `Current ${formatBytes(status.monitoring.memoryTrend.at(-1)?.rssBytes ?? 0)}`) : phrase("等待首次采样", "Waiting for first sample")}
              formatter={formatBytes}
              label={phrase("API RSS 内存", "API RSS memory")}
              locale={locale}
              phrase={phrase}
              points={status.monitoring.memoryTrend.map((point) => ({ recordedAt: point.recordedAt, value: point.rssBytes }))}
            />
            <TrendChart
              detail={status.monitoring.diskTrend.length ? phrase(`预警线 ${status.reliability.storage.warningThresholdPercent}%`, `Warning threshold ${status.reliability.storage.warningThresholdPercent}%`) : phrase("等待首次采样", "Waiting for first sample")}
              formatter={(value) => `${value.toFixed(1)}%`}
              label={phrase("磁盘使用率", "Disk usage")}
              locale={locale}
              phrase={phrase}
              points={status.monitoring.diskTrend.map((point) => ({ recordedAt: point.recordedAt, value: point.usedPercent }))}
              warningValue={status.reliability.storage.warningThresholdPercent}
            />
          </div>
        </section>

        {backupConfiguration && backupForm ? <section className="system-status-panel backup-policy">
          <header className="system-panel-heading backup-policy-heading">
            <span><CloudCog aria-hidden="true" size={17} /><strong>{phrase("自动与异地备份", "Automatic and remote backups")}</strong></span>
            <button aria-label={phrase("保存备份策略", "Save backup policy")} disabled={configurationBusy} onClick={() => void handleSaveBackupConfiguration()} title={phrase("保存备份策略", "Save backup policy")} type="button">
              <Save aria-hidden="true" size={16} />
              <span>{configurationBusy ? phrase("保存中", "Saving") : phrase("保存策略", "Save policy")}</span>
            </button>
          </header>

          <div className="backup-policy-overview">
            <label className="backup-toggle-row"><input checked={backupForm.automaticEnabled} onChange={(event) => setBackupForm({ ...backupForm, automaticEnabled: event.target.checked })} type="checkbox" /><span><strong>{phrase("每日自动备份", "Daily automatic backup")}</strong><small>{phrase("API 会在设定时间执行，服务重启后也会补跑当天尚未完成的任务。", "The API runs at the scheduled time and catches up incomplete daily jobs after restart.")}</small></span></label>
            <label><span>{phrase("执行时间", "Run time")}</span><input onChange={(event) => setBackupForm({ ...backupForm, scheduleTime: event.target.value })} type="time" value={backupForm.scheduleTime} /></label>
            <label><span>{phrase("本地保留", "Local retention")}</span><span className="backup-number-field"><input max={365} min={1} onChange={(event) => setBackupForm({ ...backupForm, localRetentionDays: Number(event.target.value) })} type="number" value={backupForm.localRetentionDays} /><em>{phrase("天", "days")}</em></span></label>
            <label><span>{phrase("远端保留", "Remote retention")}</span><span className="backup-number-field"><input max={3650} min={1} onChange={(event) => setBackupForm({ ...backupForm, remoteRetentionDays: Number(event.target.value) })} type="number" value={backupForm.remoteRetentionDays} /><em>{phrase("天", "days")}</em></span></label>
          </div>

          <div className="backup-policy-status">
            <span><small>{phrase("下次执行", "Next run")}</small><strong>{backupConfiguration.nextRunAt ? formatDateTime(backupConfiguration.nextRunAt, locale) : phrase("自动备份未启用", "Automatic backup disabled")}</strong></span>
            <span><small>{phrase("最近成功", "Latest success")}</small><strong>{backupConfiguration.lastSuccessAt ? formatDateTime(backupConfiguration.lastSuccessAt, locale) : phrase("尚无记录", "No records")}</strong></span>
            <span className={backupConfiguration.lastFailureMessage ? "error" : ""}><small>{phrase("最近异常", "Latest issue")}</small><strong title={backupConfiguration.lastFailureMessage ?? ""}>{backupConfiguration.lastFailureMessage || phrase("无", "None")}</strong></span>
          </div>

          {!backupConfiguration.encryptionConfigured ? <div className="backup-encryption-warning"><KeyRound aria-hidden="true" size={17} /><span>{phrase("服务器未配置备份加密密钥，异地备份暂时不能启用。", "The server has no backup encryption key, so remote backup cannot be enabled yet.")}</span></div> : null}

          <div className="backup-provider-section">
            <header><span><Cloud aria-hidden="true" size={17} /><strong>{phrase("阿里云 OSS", "Alibaba Cloud OSS")}</strong><small>{backupConfiguration.oss.hasAccessKeyId && backupConfiguration.oss.hasSecretAccessKey ? phrase("凭证已保存", "Credentials saved") : phrase("凭证未保存", "Credentials not saved")}</small></span><label><input checked={backupForm.ossEnabled} onChange={(event) => setBackupForm({ ...backupForm, ossEnabled: event.target.checked })} type="checkbox" /><span>{phrase("启用", "Enable")}</span></label></header>
            <div className="backup-provider-grid">
              <label><span>Region</span><input onChange={(event) => setBackupForm({ ...backupForm, ossRegion: event.target.value })} placeholder="oss-cn-hangzhou" value={backupForm.ossRegion} /></label>
              <label><span>{phrase("Endpoint（可选）", "Endpoint (optional)")}</span><input onChange={(event) => setBackupForm({ ...backupForm, ossEndpoint: event.target.value })} placeholder="https://oss-cn-hangzhou.aliyuncs.com" value={backupForm.ossEndpoint} /></label>
              <label><span>Bucket</span><input onChange={(event) => setBackupForm({ ...backupForm, ossBucket: event.target.value })} placeholder="hlovet-backups" value={backupForm.ossBucket} /></label>
              <label><span>{phrase("目录前缀", "Directory prefix")}</span><input onChange={(event) => setBackupForm({ ...backupForm, ossPrefix: event.target.value })} placeholder="database" value={backupForm.ossPrefix} /></label>
              <label><span>AccessKey ID</span><input autoComplete="off" onChange={(event) => setBackupForm({ ...backupForm, ossAccessKeyId: event.target.value, clearOssCredentials: false })} placeholder={backupConfiguration.oss.hasAccessKeyId ? phrase("已保存，留空保持不变", "Saved. Leave empty to keep it.") : phrase("请输入 AccessKey ID", "Enter AccessKey ID")} type="password" value={backupForm.ossAccessKeyId} /></label>
              <label><span>AccessKey Secret</span><input autoComplete="new-password" onChange={(event) => setBackupForm({ ...backupForm, ossAccessKeySecret: event.target.value, clearOssCredentials: false })} placeholder={backupConfiguration.oss.hasSecretAccessKey ? phrase("已保存，留空保持不变", "Saved. Leave empty to keep it.") : phrase("请输入 AccessKey Secret", "Enter AccessKey Secret")} type="password" value={backupForm.ossAccessKeySecret} /></label>
            </div>
            <div className="backup-provider-actions"><button disabled={providerTesting === "oss" || !backupConfiguration.oss.hasAccessKeyId || !backupConfiguration.oss.hasSecretAccessKey} onClick={() => void handleTestBackupProvider("oss")} type="button">{providerTesting === "oss" ? phrase("测试中", "Testing") : phrase("测试已保存配置", "Test saved configuration")}</button>{backupConfiguration.oss.hasAccessKeyId || backupConfiguration.oss.hasSecretAccessKey ? <button className="danger" onClick={() => setBackupForm({ ...backupForm, clearOssCredentials: true, ossAccessKeyId: "", ossAccessKeySecret: "", ossEnabled: false })} type="button">{phrase("清除凭证", "Clear credentials")}</button> : null}</div>
          </div>

          <div className="backup-provider-section">
            <header><span><Cloud aria-hidden="true" size={17} /><strong>Cloudflare R2</strong><small>{backupConfiguration.r2.hasAccessKeyId && backupConfiguration.r2.hasSecretAccessKey ? phrase("凭证已保存", "Credentials saved") : phrase("凭证未保存", "Credentials not saved")}</small></span><label><input checked={backupForm.r2Enabled} onChange={(event) => setBackupForm({ ...backupForm, r2Enabled: event.target.checked })} type="checkbox" /><span>{phrase("启用", "Enable")}</span></label></header>
            <div className="backup-provider-grid r2">
              <label><span>Account ID</span><input onChange={(event) => setBackupForm({ ...backupForm, r2AccountId: event.target.value })} placeholder="Cloudflare Account ID" value={backupForm.r2AccountId} /></label>
              <label><span>Bucket</span><input onChange={(event) => setBackupForm({ ...backupForm, r2Bucket: event.target.value })} placeholder="hlovet-backups" value={backupForm.r2Bucket} /></label>
              <label><span>{phrase("目录前缀", "Directory prefix")}</span><input onChange={(event) => setBackupForm({ ...backupForm, r2Prefix: event.target.value })} placeholder="database" value={backupForm.r2Prefix} /></label>
              <label><span>Access Key ID</span><input autoComplete="off" onChange={(event) => setBackupForm({ ...backupForm, r2AccessKeyId: event.target.value, clearR2Credentials: false })} placeholder={backupConfiguration.r2.hasAccessKeyId ? phrase("已保存，留空保持不变", "Saved. Leave empty to keep it.") : phrase("请输入 Access Key ID", "Enter Access Key ID")} type="password" value={backupForm.r2AccessKeyId} /></label>
              <label><span>Secret Access Key</span><input autoComplete="new-password" onChange={(event) => setBackupForm({ ...backupForm, r2SecretAccessKey: event.target.value, clearR2Credentials: false })} placeholder={backupConfiguration.r2.hasSecretAccessKey ? phrase("已保存，留空保持不变", "Saved. Leave empty to keep it.") : phrase("请输入 Secret Access Key", "Enter Secret Access Key")} type="password" value={backupForm.r2SecretAccessKey} /></label>
            </div>
            <div className="backup-provider-actions"><button disabled={providerTesting === "r2" || !backupConfiguration.r2.hasAccessKeyId || !backupConfiguration.r2.hasSecretAccessKey} onClick={() => void handleTestBackupProvider("r2")} type="button">{providerTesting === "r2" ? phrase("测试中", "Testing") : phrase("测试已保存配置", "Test saved configuration")}</button>{backupConfiguration.r2.hasAccessKeyId || backupConfiguration.r2.hasSecretAccessKey ? <button className="danger" onClick={() => setBackupForm({ ...backupForm, clearR2Credentials: true, r2AccessKeyId: "", r2SecretAccessKey: "", r2Enabled: false })} type="button">{phrase("清除凭证", "Clear credentials")}</button> : null}</div>
          </div>
        </section> : null}

      </div>
    </> : <div className="system-status-empty"><CircleAlert aria-hidden="true" size={22} /><span>{phrase("暂时无法读取系统状态，请稍后刷新。", "System status is unavailable. Refresh and try again.")}</span></div>}
    {restoreTarget ? <div className="modal-backdrop modal-backdrop--light" onMouseDown={(event) => { if (event.target === event.currentTarget && !backupBusy) { setRestoreTarget(""); setRestorePreflight(null); } }} role="presentation"><div aria-modal="true" className="modal-panel backup-restore-modal" role="dialog"><div className="modal-heading"><span className="section-label">Database restore</span><h2>{phrase("恢复数据库", "Restore database")}</h2><p>{phrase("系统先校验数据库与媒体归档，再创建恢复前安全备份。媒体恢复采用追加方式，不会删除现有上传文件。", "The system verifies the database and media archive, then creates a safety backup before restoration. Media restoration only adds files and does not delete existing uploads.")}</p></div>{backupBusy.startsWith("preflight:") ? <p className="backup-preflight-loading">{phrase("正在完整校验备份归档...", "Verifying backup archive...")}</p> : restorePreflight ? <div className="backup-preflight"><span className={restorePreflight.backup.verification.databaseValid ? "ok" : "error"}>{phrase("数据库归档：", "Database archive: ")}{restorePreflight.backup.verification.databaseValid ? phrase("可读取", "Readable") : phrase("校验失败", "Verification failed")}</span><span className={restorePreflight.backup.mediaSnapshotAvailable && !restorePreflight.backup.verification.mediaValid ? "error" : "ok"}>{phrase("媒体快照：", "Media snapshot: ")}{restorePreflight.backup.mediaSnapshotAvailable ? restorePreflight.backup.verification.mediaValid ? phrase(`${restorePreflight.backup.verification.mediaFileCount ?? 0} 个文件，六目录完整`, `${restorePreflight.backup.verification.mediaFileCount ?? 0} files across all six directories`) : phrase("校验失败", "Verification failed") : phrase("旧备份，仅数据库", "Legacy backup, database only")}</span>{restorePreflight.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div> : <p className="backup-preflight-loading">{phrase("无法读取校验结果。", "Could not read verification result.")}</p>}<label className="backup-confirm-field"><span>{restoreTarget}</span><input autoFocus disabled={!restorePreflight?.canRestore || Boolean(backupBusy)} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder={phrase("输入上方完整文件名", "Enter the full file name above")} value={restoreConfirmation} /></label><div className="actions"><button className="button" disabled={!restorePreflight?.canRestore || restoreConfirmation !== restoreTarget || Boolean(backupBusy)} onClick={() => void handleRestoreBackup()} type="button">{backupBusy ? phrase("恢复中", "Restoring") : phrase("确认恢复", "Confirm restore")}</button><button className="button secondary" disabled={Boolean(backupBusy)} onClick={() => { setRestoreTarget(""); setRestorePreflight(null); }} type="button">{phrase("取消", "Cancel")}</button></div></div></div> : null}
    {selectedMediaJob ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMediaJob(null); }} role="presentation"><div aria-modal="true" className="modal-panel media-backup-detail-modal" role="dialog">
      <header><span><small>Media backup</small><h2>{phrase(`媒体备份任务 #${selectedMediaJob.id}`, `Media backup job #${selectedMediaJob.id}`)}</h2></span><button aria-label={phrase("关闭任务详情", "Close job details")} onClick={() => setSelectedMediaJob(null)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={18} /></button></header>
      <div className="media-backup-detail-summary"><span><small>{phrase("状态", "Status")}</small><strong className={mediaJobTone(selectedMediaJob.status)}>{mediaJobStatusLabel(selectedMediaJob.status, phrase)}</strong></span><span><small>{phrase("文件", "Files")}</small><strong>{selectedMediaJob.processedFiles} / {selectedMediaJob.totalFiles}</strong></span><span><small>{phrase("上传流量", "Upload traffic")}</small><strong>{formatBytes(selectedMediaJob.uploadedBytes)}</strong></span><span><small>{phrase("提供商", "Providers")}</small><strong>{selectedMediaJob.providers.map((provider) => providerLabel(provider, phrase)).join(" · ") || phrase("未配置", "Not configured")}</strong></span></div>
      <section><h3>{phrase("任务日志", "Job logs")}</h3><div className="media-backup-log-list">{selectedMediaJob.logs.map((log) => <article className={log.level} key={log.id}><time>{formatDateTime(log.createdAt, locale)}</time><span>{mediaBackupLogMessage(log, selectedMediaJob, locale)}</span></article>)}{!selectedMediaJob.logs.length ? <p>{phrase("暂无任务日志。", "No job logs.")}</p> : null}</div></section>
      <section><h3>{phrase("文件清单", "File manifest")}</h3><div className="media-backup-manifest-list">{selectedMediaJob.manifests.map((manifest) => <article key={manifest.id}><span><strong title={manifest.storedName}>{manifest.storedName}</strong><small>{providerLabel(manifest.provider, phrase)} · {formatBytes(manifest.sizeBytes)}</small></span><i className={mediaManifestTone(manifest.status)}>{mediaManifestStatusLabel(manifest.status, phrase)}</i></article>)}{!selectedMediaJob.manifests.length ? <p>{phrase("任务尚未生成文件清单。", "This job has not created a file manifest yet.")}</p> : null}</div></section>
    </div></div> : null}
  </section>;
}

function OverviewItem({ icon: Icon, label, value, valueClassName, detail, tone }: { icon: typeof Activity; label: string; value: string; valueClassName?: string; detail: string; tone: "ok" | "error" | "warning" | "neutral" }) {
  return <div className={`system-overview-item ${tone}`}><span><Icon aria-hidden="true" size={18} /></span><div><small>{label}</small><strong className={valueClassName} title={value}>{value}</strong><em title={detail}>{detail}</em></div></div>;
}

function PanelHeading({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return <header className="system-panel-heading"><Icon aria-hidden="true" size={17} /><strong>{title}</strong></header>;
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="system-status-line"><span>{ok ? <CircleCheck aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}<small>{label}</small></span><strong title={value}>{value}</strong></div>;
}

function TrendChart({ detail, formatter, label, locale, phrase, points, warningValue }: {
  detail: string;
  formatter: (value: number) => string;
  label: string;
  locale: "zh-CN" | "en-US";
  phrase: Phrase;
  points: Array<{ recordedAt: string; value: number }>;
  warningValue?: number;
}) {
  const visiblePoints = points.slice(-90);
  const values = visiblePoints.map((point) => point.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const range = Math.max(1, maximum - minimum);
  const line = visiblePoints.map((point, index) => {
    const x = visiblePoints.length < 2 ? 120 : index / (visiblePoints.length - 1) * 240;
    const y = 58 - (point.value - minimum) / range * 48;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latestValue = values.at(-1) ?? null;
  const warning = latestValue !== null && warningValue !== undefined && latestValue >= warningValue;
  return <div className={`system-trend-row ${warning ? "warning" : ""}`}>
    <div><span><strong>{label}</strong><small>{detail}</small></span><b>{latestValue === null ? "-" : formatter(latestValue)}</b></div>
    <svg aria-label={phrase(`${label}趋势`, `${label} trend`)} preserveAspectRatio="none" role="img" viewBox="0 0 240 64">
      <line x1="0" x2="240" y1="58" y2="58" />
      {line ? <polyline fill="none" points={line} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <footer><span>{values.length ? formatter(minimum) : phrase("暂无数据", "No data")}</span><span>{visiblePoints.length > 1 ? formatShortTime(visiblePoints[0].recordedAt, locale) : ""}</span><span>{visiblePoints.length > 1 ? formatShortTime(visiblePoints.at(-1)?.recordedAt ?? "", locale) : ""}</span><span>{values.length ? formatter(maximum) : ""}</span></footer>
  </div>;
}

function MonitoringEventList({ empty, events, locale, phrase, title }: {
  empty: string;
  events: SystemStatus["monitoring"]["slowRequests"];
  locale: "zh-CN" | "en-US";
  phrase: Phrase;
  title: string;
}) {
  return <div className="system-monitoring-events">
    <header><strong>{title}</strong><span>{phrase(`${events.length} 条`, `${events.length} events`)}</span></header>
    {events.length ? <div>{events.map((event, index) => <article key={`${event.occurredAt}-${event.method}-${event.path}-${index}`}>
      <span><b>{event.method}</b><strong title={event.path}>{event.path}</strong></span>
      <span><em>{event.statusCode}</em><em>{event.durationMs.toFixed(1)} ms</em><time>{formatDateTime(event.occurredAt, locale)}</time></span>
      {event.message ? <p title={event.message}>{event.message}</p> : null}
    </article>)}</div> : <p>{empty}</p>}
  </div>;
}

function toBackupConfigurationForm(configuration: BackupConfiguration): BackupConfigurationForm {
  return {
    automaticEnabled: configuration.automaticEnabled,
    scheduleTime: configuration.scheduleTime,
    localRetentionDays: configuration.localRetentionDays,
    remoteRetentionDays: configuration.remoteRetentionDays,
    ossEnabled: configuration.oss.enabled,
    ossRegion: configuration.oss.region,
    ossEndpoint: configuration.oss.endpoint,
    ossBucket: configuration.oss.bucket,
    ossPrefix: configuration.oss.prefix,
    ossAccessKeyId: "",
    ossAccessKeySecret: "",
    clearOssCredentials: false,
    r2Enabled: configuration.r2.enabled,
    r2AccountId: configuration.r2.accountId,
    r2Bucket: configuration.r2.bucket,
    r2Prefix: configuration.r2.prefix,
    r2AccessKeyId: "",
    r2SecretAccessKey: "",
    clearR2Credentials: false,
  };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatNullableBytes(value: number | null, phrase: Phrase): string {
  return value === null ? phrase("无法读取", "Unavailable") : formatBytes(value);
}

function formatMemoryUsage(used: number | null, max: number | null, phrase: Phrase): string {
  if (used === null) return phrase("无法读取", "Unavailable");
  return max && max > 0 ? `${formatBytes(used)} / ${formatBytes(max)}` : formatBytes(used);
}

function formatDuration(seconds: number, phrase: Phrase): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return phrase(`${days} 天 ${hours} 小时`, `${days}d ${hours}h`);
  if (hours) return phrase(`${hours} 小时 ${minutes} 分`, `${hours}h ${minutes}m`);
  return phrase(`${minutes} 分钟`, `${minutes} min`);
}

function formatDateTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function formatShortTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function formatCoverage(value: number | null, phrase: Phrase): string {
  return value === null ? phrase("待生成目录", "Awaiting directory") : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function formatAnomalySummary(anomalies: SystemStatus["reliability"]["anomalies"], phrase: Phrase): string {
  const details = [
    [phrase("备份失败", "Backup failures"), anomalies.backupFailures],
    [phrase("磁盘预警", "Disk warnings"), anomalies.diskPressure],
    [phrase("缺失文件", "Missing files"), anomalies.missingFiles],
    [phrase("孤立文件", "Orphan files"), anomalies.orphanFiles],
    [phrase("大小不一致", "Size mismatch"), anomalies.metadataMismatches],
    [phrase("接口错误", "API errors"), anomalies.recentApiErrors],
  ].filter((item): item is [string, number] => Number(item[1]) > 0);

  return details.length ? details.map(([label, count]) => `${label} ${count}`).join(" · ") : phrase("当前未发现异常", "No issues detected");
}

function formatBackupSource(value: "media" | "database" | null, phrase: Phrase): string {
  if (value === "media") return phrase("媒体文件备份", "Media backup");
  if (value === "database") return phrase("数据库备份", "Database backup");
  return phrase("等待首次成功任务", "Waiting for first successful job");
}

function backupVerificationLabel(status: BackupRestorePreflight["backup"]["verification"]["status"], phrase: Phrase): string {
  return ({
    verified: phrase("已校验", "Verified"),
    database_only: phrase("仅数据库已校验", "Database verified"),
    failed: phrase("校验失败", "Verification failed"),
    not_verified: phrase("未校验", "Not verified"),
  })[status];
}

function enabledProviderLabel(configuration: BackupConfiguration, phrase: Phrase): string {
  const providers = [
    configuration.oss.enabled ? "OSS" : null,
    configuration.r2.enabled ? "R2" : null,
  ].filter(Boolean);
  return providers.length ? providers.join(" + ") : phrase("未启用", "Not enabled");
}

function providerLabel(provider: "oss" | "r2", phrase: Phrase): string {
  return provider === "oss" ? phrase("阿里云 OSS", "Alibaba Cloud OSS") : "Cloudflare R2";
}

function mediaJobStatusLabel(status: MediaBackupJob["status"], phrase: Phrase): string {
  return ({ pending: phrase("等待中", "Pending"), running: phrase("执行中", "Running"), completed: phrase("已完成", "Completed"), partial: phrase("部分失败", "Partially failed"), failed: phrase("失败", "Failed") })[status];
}

function mediaJobTone(status: MediaBackupJob["status"]): string {
  if (status === "completed") return "success";
  if (status === "partial") return "warning";
  if (status === "failed") return "error";
  return "running";
}

function mediaManifestStatusLabel(status: MediaBackupJobDetail["manifests"][number]["status"], phrase: Phrase): string {
  return ({ pending: phrase("等待中", "Pending"), uploaded: phrase("已上传", "Uploaded"), reused: phrase("已复用", "Reused"), skipped: phrase("已跳过", "Skipped"), failed: phrase("失败", "Failed") })[status];
}

function mediaManifestTone(status: MediaBackupJobDetail["manifests"][number]["status"]): string {
  if (status === "uploaded" || status === "reused") return "success";
  if (status === "skipped") return "warning";
  if (status === "failed") return "error";
  return "running";
}
