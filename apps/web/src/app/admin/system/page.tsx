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
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  downloadDatabaseBackup,
  getBackupConfiguration,
  getMediaBackupJob,
  getStorageOverview,
  getSystemStatus,
  listMediaBackupJobs,
  restoreDatabaseBackup,
  startMediaBackup,
  testBackupProvider,
  updateBackupConfiguration,
  type BackupConfiguration,
  type BackupConfigurationUpdate,
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

export default function SystemStatusPage() {
  const router = useRouter();
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

  const loadStatus = useCallback(async (token: string, refresh = false) => {
    if (refresh) setIsRefreshing(true);
    setError("");
    try {
      setStatus(await getSystemStatus(token));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "系统状态读取失败。");
    } finally {
      if (refresh) setIsRefreshing(false);
    }
  }, [router]);

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
      router.replace("/login");
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
          router.replace("/");
          return;
        }
        if (active) setError(loadError instanceof Error ? loadError.message : "无法验证访问权限。");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [loadBackupConfiguration, loadMediaJobs, loadStatus, loadStorageOverview, router]);

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
      await refreshAfterBackup(backup.warning || `备份已创建：${backup.name}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "数据库备份创建失败。");
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
      setNotice(`媒体备份任务 #${job.id} 已开始。`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "媒体备份启动失败。");
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
      setError(actionError instanceof Error ? actionError.message : "媒体备份任务读取失败。");
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
      setNotice("备份策略已保存。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "备份策略保存失败。");
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
      setNotice(`${provider === "oss" ? "阿里云 OSS" : "Cloudflare R2"} 连接正常。`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "异地备份连接测试失败。");
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
      setNotice("备份下载已开始。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "备份下载失败。");
    } finally {
      setBackupBusy("");
    }
  }

  async function handleDeleteBackup(name: string) {
    if (!accessToken || backupBusy || !window.confirm(`永久删除备份 ${name} 吗？`)) return;
    setBackupBusy(`delete:${name}`);
    setError("");
    try {
      await deleteDatabaseBackup(accessToken, name);
      await refreshAfterBackup("备份文件已删除。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "备份删除失败。");
    } finally {
      setBackupBusy("");
    }
  }

  async function handleRestoreBackup() {
    if (!accessToken || !restoreTarget || restoreConfirmation !== restoreTarget || backupBusy) return;
    setBackupBusy(`restore:${restoreTarget}`);
    setError("");
    try {
      const restored = await restoreDatabaseBackup(accessToken, restoreTarget);
      setRestoreTarget("");
      setRestoreConfirmation("");
      await refreshAfterBackup(`数据库已恢复，恢复前备份：${restored.safetyBackup.name}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "数据库恢复失败。");
    } finally {
      setBackupBusy("");
    }
  }

  if (isLoading) {
    return <section className="page-shell admin-shell system-status-shell"><span className="status">正在读取系统状态</span></section>;
  }

  if (!currentUser?.isSuperAdmin) {
    return <section className="page-shell admin-shell system-status-shell">
      <h1>无权访问</h1>
      <p>系统运行概览仅超级管理员可以查看。</p>
      <Link className="text-action primary" href="/">返回首页</Link>
    </section>;
  }

  return <section className="page-shell admin-shell system-status-shell">
    <AppToast duration={error ? 4200 : 3200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    <header className="system-status-head">
      <div><span className="section-label">HLOVET Operations</span><h1>系统运行概览</h1></div>
      <div className="system-status-head-actions">
        {status ? <small>更新于 {formatDateTime(status.generatedAt)}</small> : null}
        <button aria-label="刷新系统状态" disabled={isRefreshing || !accessToken} onClick={() => accessToken && void Promise.all([loadStatus(accessToken, true), loadStorageOverview(accessToken), loadMediaJobs(accessToken)])} title="刷新" type="button">
          <RefreshCcw aria-hidden="true" className={isRefreshing ? "spin" : ""} size={17} />
        </button>
      </div>
    </header>

    {status ? <>
      <div className="system-overview-strip">
        <OverviewItem icon={Activity} label="API 运行" value={formatDuration(status.application.uptimeSeconds)} detail={`RSS ${formatBytes(status.application.memory.rssBytes)}`} tone="ok" />
        <OverviewItem icon={Database} label="MySQL" value={status.database.connected ? "连接正常" : "连接异常"} detail={status.database.connected ? `${status.database.latencyMs ?? 0} ms` : status.database.error ?? "读取失败"} tone={status.database.connected ? "ok" : "error"} />
        <OverviewItem icon={Server} label="Redis" value={status.redis.connected ? "连接正常" : "连接异常"} detail={status.redis.connected ? `${status.redis.keyCount ?? 0} 个键` : status.redis.error ?? "读取失败"} tone={status.redis.connected ? "ok" : "error"} />
        <OverviewItem icon={Files} label="文件存储" value={formatBytes(status.storage.totalBytes)} detail={`${status.storage.totalFiles} 个文件`} tone="neutral" />
        <OverviewItem icon={Archive} label="媒体备份覆盖" value={formatCoverage(status.reliability.backupCoverage.percentage)} detail={`${status.reliability.backupCoverage.backedUpFiles} / ${status.reliability.backupCoverage.totalFiles} 个文件`} tone={status.reliability.backupCoverage.uncoveredFiles ? "warning" : "ok"} />
        <OverviewItem icon={Clock3} label="最近备份成功" value={status.reliability.lastSuccessfulBackupAt ? formatDateTime(status.reliability.lastSuccessfulBackupAt) : "暂无成功记录"} valueClassName="datetime" detail={formatBackupSource(status.reliability.lastSuccessfulBackupSource)} tone={status.reliability.lastSuccessfulBackupAt ? "ok" : "neutral"} />
        <OverviewItem icon={CircleAlert} label={`近 ${status.reliability.anomalyWindowHours} 小时异常`} value={`${status.reliability.anomalies.total} 项`} detail={formatAnomalySummary(status.reliability.anomalies)} tone={status.reliability.anomalies.total ? "error" : "ok"} />
      </div>

      <div className="system-status-grid">
        <section className="system-status-panel services">
          <PanelHeading icon={Box} title="服务状态" />
          <StatusLine label="API 运行环境" value={`${status.application.environment} / ${status.application.nodeVersion}`} ok />
          <StatusLine label="MySQL 版本" value={status.database.version ?? "无法读取"} ok={status.database.connected} />
          <StatusLine label="数据库容量" value={formatNullableBytes(status.database.sizeBytes)} ok={status.database.connected} />
          <StatusLine label="Prisma 迁移" value={status.database.latestMigration ? `${status.database.migrationCount ?? 0} 项 · ${status.database.latestMigration.name}` : "暂无迁移记录"} ok={status.database.connected} />
          <StatusLine label="Redis 版本" value={status.redis.version ?? "无法读取"} ok={status.redis.connected} />
          <StatusLine label="Redis 内存" value={formatMemoryUsage(status.redis.usedMemoryBytes, status.redis.maxMemoryBytes)} ok={status.redis.connected} />
        </section>

        <section className="system-status-panel storage">
          <PanelHeading icon={HardDrive} title="文件存储分布" />
          <div className="system-storage-list">
            {status.storage.items.map((item) => <div className="system-storage-row" key={item.key}>
              <div><strong>{item.label}</strong><span>{item.available ? `${item.fileCount} 个文件` : "目录暂不可用"}</span></div>
              <b>{formatBytes(item.sizeBytes)}</b>
              <i><span style={{ width: `${Math.max(item.sizeBytes ? 4 : 0, item.sizeBytes / largestStorageBytes * 100)}%` }} /></i>
            </div>)}
          </div>
          <div className={`system-storage-health-link ${(storageOverview?.openIssues.total ?? 0) ? "warning" : "ok"}`}>
            <span><ShieldCheck aria-hidden="true" size={16} /><small>{storageOverview?.latestScan ? `${storageOverview.openIssues.total} 项待处理 · ${formatDateTime(storageOverview.latestScan.completedAt || storageOverview.latestScan.startedAt)}` : "尚未执行完整性扫描"}</small></span>
            <Link href="/admin/storage">存储管理</Link>
          </div>
        </section>

        <section className="system-status-panel backups">
          <header className="system-panel-heading system-backup-heading"><span><Archive aria-hidden="true" size={17} /><strong>数据库备份</strong></span><button disabled={Boolean(backupBusy)} onClick={() => void handleCreateBackup()} type="button">{backupBusy === "create" ? "备份中" : "立即备份"}</button></header>
          <div className="system-backup-summary">
            <span><Clock3 aria-hidden="true" size={16} /><small>最近备份</small><strong>{status.backups.latest ? formatDateTime(status.backups.latest.updatedAt) : "暂无可见备份"}</strong></span>
            <span><HardDrive aria-hidden="true" size={16} /><small>备份占用</small><strong>{formatBytes(status.backups.totalBytes)}</strong></span>
          </div>
          <div className="system-backup-list">
            {status.backups.items.map((backup) => <div className="system-backup-row" key={backup.name}><span><strong title={backup.name}>{backup.name}</strong><small>{formatDateTime(backup.updatedAt)}</small></span><b>{formatBytes(backup.sizeBytes)}</b><span className="system-backup-actions"><button aria-label={`下载 ${backup.name}`} disabled={Boolean(backupBusy)} onClick={() => void handleDownloadBackup(backup.name)} title="下载" type="button"><Download aria-hidden="true" size={15} /></button><button aria-label={`恢复 ${backup.name}`} disabled={Boolean(backupBusy)} onClick={() => { setRestoreTarget(backup.name); setRestoreConfirmation(""); }} title="恢复" type="button"><ArchiveRestore aria-hidden="true" size={15} /></button><button aria-label={`删除 ${backup.name}`} disabled={Boolean(backupBusy)} onClick={() => void handleDeleteBackup(backup.name)} title="删除" type="button"><Trash2 aria-hidden="true" size={15} /></button></span></div>)}
            {!status.backups.items.length ? <p>{status.backups.available ? "备份目录中暂无 SQL 备份文件。" : "备份目录尚未挂载或不可读取。"}</p> : null}
          </div>
        </section>

        <section className="system-status-panel media-backups">
          <header className="system-panel-heading system-backup-heading">
            <span><CloudUpload aria-hidden="true" size={17} /><strong>媒体文件备份</strong></span>
            <button disabled={Boolean(mediaBusy) || mediaJobs.some((job) => job.status === "pending" || job.status === "running")} onClick={() => void handleStartMediaBackup()} type="button">
              {mediaBusy === "start" ? "启动中" : mediaJobs.some((job) => job.status === "pending" || job.status === "running") ? "备份中" : "立即备份"}
            </button>
          </header>
          <div className="media-backup-summary">
            <span><small>覆盖率</small><strong>{formatCoverage(status.reliability.backupCoverage.percentage)}</strong></span>
            <span><small>未备份</small><strong>{status.reliability.backupCoverage.uncoveredFiles} 个文件</strong></span>
            <span><small>远端</small><strong>{backupConfiguration ? enabledProviderLabel(backupConfiguration) : "读取中"}</strong></span>
          </div>
          <div className="media-backup-job-list">
            {mediaJobs.map((job) => <button disabled={Boolean(mediaBusy)} key={job.id} onClick={() => void handleOpenMediaJob(job.id)} type="button">
              <span><i className={mediaJobTone(job.status)}>{mediaJobStatusLabel(job.status)}</i><strong>任务 #{job.id}</strong><small>{formatDateTime(job.completedAt || job.startedAt || job.createdAt)}</small></span>
              <span><b>{job.processedFiles} / {job.totalFiles}</b><small>上传 {job.uploadedFiles} · 复用 {job.reusedFiles} · 失败 {job.failedFiles}</small></span>
              <ListChecks aria-hidden="true" size={15} />
            </button>)}
            {!mediaJobs.length ? <p>还没有媒体备份任务。配置并启用 OSS 或 R2 后可开始首轮备份。</p> : null}
          </div>
        </section>

        <div className="system-monitoring-left">
          <section className="system-status-panel runtime">
            <PanelHeading icon={Server} title="容器与宿主机" />
            <div className="system-runtime-note"><CircleAlert aria-hidden="true" size={20} /><p>{status.containerRuntime.message}</p></div>
            <div className="system-runtime-links"><span>容器启停、CPU、整机内存和磁盘清理由 1Panel 或 SSH 负责。</span><Link href="/admin/cache">查看 Redis 缓存</Link><Link href="/admin/settings">查看站点资源</Link></div>
          </section>

          <section className="system-status-panel monitoring-events">
            <header className="system-panel-heading system-monitoring-heading"><span><CircleAlert aria-hidden="true" size={17} /><strong>接口观察</strong></span><small>慢接口阈值 {status.monitoring.slowRequestThresholdMs} ms</small></header>
            <MonitoringEventList empty="最近没有慢接口" events={status.monitoring.slowRequests.slice(0, 5)} title="慢接口" />
            <MonitoringEventList empty="最近没有 API 5xx 错误" events={status.monitoring.recentErrors.slice(0, 5)} title="最近错误" />
          </section>
        </div>

        <section className="system-status-panel monitoring-trends">
          <header className="system-panel-heading system-monitoring-heading"><span><Activity aria-hidden="true" size={17} /><strong>资源趋势</strong></span><small>每分钟采样 · 最近 24 小时</small></header>
          <div className="system-trend-list">
            <TrendChart
              detail={status.monitoring.memoryTrend.length ? `当前 ${formatBytes(status.monitoring.memoryTrend.at(-1)?.rssBytes ?? 0)}` : "等待首次采样"}
              formatter={formatBytes}
              label="API RSS 内存"
              points={status.monitoring.memoryTrend.map((point) => ({ recordedAt: point.recordedAt, value: point.rssBytes }))}
            />
            <TrendChart
              detail={status.monitoring.diskTrend.length ? `预警线 ${status.reliability.storage.warningThresholdPercent}%` : "等待首次采样"}
              formatter={(value) => `${value.toFixed(1)}%`}
              label="磁盘使用率"
              points={status.monitoring.diskTrend.map((point) => ({ recordedAt: point.recordedAt, value: point.usedPercent }))}
              warningValue={status.reliability.storage.warningThresholdPercent}
            />
          </div>
        </section>

        {backupConfiguration && backupForm ? <section className="system-status-panel backup-policy">
          <header className="system-panel-heading backup-policy-heading">
            <span><CloudCog aria-hidden="true" size={17} /><strong>自动与异地备份</strong></span>
            <button aria-label="保存备份策略" disabled={configurationBusy} onClick={() => void handleSaveBackupConfiguration()} title="保存备份策略" type="button">
              <Save aria-hidden="true" size={16} />
              <span>{configurationBusy ? "保存中" : "保存策略"}</span>
            </button>
          </header>

          <div className="backup-policy-overview">
            <label className="backup-toggle-row"><input checked={backupForm.automaticEnabled} onChange={(event) => setBackupForm({ ...backupForm, automaticEnabled: event.target.checked })} type="checkbox" /><span><strong>每日自动备份</strong><small>API 会在设定时间执行，服务重启后也会补跑当天尚未完成的任务。</small></span></label>
            <label><span>执行时间</span><input onChange={(event) => setBackupForm({ ...backupForm, scheduleTime: event.target.value })} type="time" value={backupForm.scheduleTime} /></label>
            <label><span>本地保留</span><span className="backup-number-field"><input max={365} min={1} onChange={(event) => setBackupForm({ ...backupForm, localRetentionDays: Number(event.target.value) })} type="number" value={backupForm.localRetentionDays} /><em>天</em></span></label>
            <label><span>远端保留</span><span className="backup-number-field"><input max={3650} min={1} onChange={(event) => setBackupForm({ ...backupForm, remoteRetentionDays: Number(event.target.value) })} type="number" value={backupForm.remoteRetentionDays} /><em>天</em></span></label>
          </div>

          <div className="backup-policy-status">
            <span><small>下次执行</small><strong>{backupConfiguration.nextRunAt ? formatDateTime(backupConfiguration.nextRunAt) : "自动备份未启用"}</strong></span>
            <span><small>最近成功</small><strong>{backupConfiguration.lastSuccessAt ? formatDateTime(backupConfiguration.lastSuccessAt) : "尚无记录"}</strong></span>
            <span className={backupConfiguration.lastFailureMessage ? "error" : ""}><small>最近异常</small><strong title={backupConfiguration.lastFailureMessage ?? ""}>{backupConfiguration.lastFailureMessage || "无"}</strong></span>
          </div>

          {!backupConfiguration.encryptionConfigured ? <div className="backup-encryption-warning"><KeyRound aria-hidden="true" size={17} /><span>服务器未配置备份加密密钥，异地备份暂时不能启用。</span></div> : null}

          <div className="backup-provider-section">
            <header><span><Cloud aria-hidden="true" size={17} /><strong>阿里云 OSS</strong><small>{backupConfiguration.oss.hasAccessKeyId && backupConfiguration.oss.hasSecretAccessKey ? "凭证已保存" : "凭证未保存"}</small></span><label><input checked={backupForm.ossEnabled} onChange={(event) => setBackupForm({ ...backupForm, ossEnabled: event.target.checked })} type="checkbox" /><span>启用</span></label></header>
            <div className="backup-provider-grid">
              <label><span>Region</span><input onChange={(event) => setBackupForm({ ...backupForm, ossRegion: event.target.value })} placeholder="oss-cn-hangzhou" value={backupForm.ossRegion} /></label>
              <label><span>Endpoint（可选）</span><input onChange={(event) => setBackupForm({ ...backupForm, ossEndpoint: event.target.value })} placeholder="https://oss-cn-hangzhou.aliyuncs.com" value={backupForm.ossEndpoint} /></label>
              <label><span>Bucket</span><input onChange={(event) => setBackupForm({ ...backupForm, ossBucket: event.target.value })} placeholder="hlovet-backups" value={backupForm.ossBucket} /></label>
              <label><span>目录前缀</span><input onChange={(event) => setBackupForm({ ...backupForm, ossPrefix: event.target.value })} placeholder="database" value={backupForm.ossPrefix} /></label>
              <label><span>AccessKey ID</span><input autoComplete="off" onChange={(event) => setBackupForm({ ...backupForm, ossAccessKeyId: event.target.value, clearOssCredentials: false })} placeholder={backupConfiguration.oss.hasAccessKeyId ? "已保存，留空保持不变" : "请输入 AccessKey ID"} type="password" value={backupForm.ossAccessKeyId} /></label>
              <label><span>AccessKey Secret</span><input autoComplete="new-password" onChange={(event) => setBackupForm({ ...backupForm, ossAccessKeySecret: event.target.value, clearOssCredentials: false })} placeholder={backupConfiguration.oss.hasSecretAccessKey ? "已保存，留空保持不变" : "请输入 AccessKey Secret"} type="password" value={backupForm.ossAccessKeySecret} /></label>
            </div>
            <div className="backup-provider-actions"><button disabled={providerTesting === "oss" || !backupConfiguration.oss.hasAccessKeyId || !backupConfiguration.oss.hasSecretAccessKey} onClick={() => void handleTestBackupProvider("oss")} type="button">{providerTesting === "oss" ? "测试中" : "测试已保存配置"}</button>{backupConfiguration.oss.hasAccessKeyId || backupConfiguration.oss.hasSecretAccessKey ? <button className="danger" onClick={() => setBackupForm({ ...backupForm, clearOssCredentials: true, ossAccessKeyId: "", ossAccessKeySecret: "", ossEnabled: false })} type="button">清除凭证</button> : null}</div>
          </div>

          <div className="backup-provider-section">
            <header><span><Cloud aria-hidden="true" size={17} /><strong>Cloudflare R2</strong><small>{backupConfiguration.r2.hasAccessKeyId && backupConfiguration.r2.hasSecretAccessKey ? "凭证已保存" : "凭证未保存"}</small></span><label><input checked={backupForm.r2Enabled} onChange={(event) => setBackupForm({ ...backupForm, r2Enabled: event.target.checked })} type="checkbox" /><span>启用</span></label></header>
            <div className="backup-provider-grid r2">
              <label><span>Account ID</span><input onChange={(event) => setBackupForm({ ...backupForm, r2AccountId: event.target.value })} placeholder="Cloudflare Account ID" value={backupForm.r2AccountId} /></label>
              <label><span>Bucket</span><input onChange={(event) => setBackupForm({ ...backupForm, r2Bucket: event.target.value })} placeholder="hlovet-backups" value={backupForm.r2Bucket} /></label>
              <label><span>目录前缀</span><input onChange={(event) => setBackupForm({ ...backupForm, r2Prefix: event.target.value })} placeholder="database" value={backupForm.r2Prefix} /></label>
              <label><span>Access Key ID</span><input autoComplete="off" onChange={(event) => setBackupForm({ ...backupForm, r2AccessKeyId: event.target.value, clearR2Credentials: false })} placeholder={backupConfiguration.r2.hasAccessKeyId ? "已保存，留空保持不变" : "请输入 Access Key ID"} type="password" value={backupForm.r2AccessKeyId} /></label>
              <label><span>Secret Access Key</span><input autoComplete="new-password" onChange={(event) => setBackupForm({ ...backupForm, r2SecretAccessKey: event.target.value, clearR2Credentials: false })} placeholder={backupConfiguration.r2.hasSecretAccessKey ? "已保存，留空保持不变" : "请输入 Secret Access Key"} type="password" value={backupForm.r2SecretAccessKey} /></label>
            </div>
            <div className="backup-provider-actions"><button disabled={providerTesting === "r2" || !backupConfiguration.r2.hasAccessKeyId || !backupConfiguration.r2.hasSecretAccessKey} onClick={() => void handleTestBackupProvider("r2")} type="button">{providerTesting === "r2" ? "测试中" : "测试已保存配置"}</button>{backupConfiguration.r2.hasAccessKeyId || backupConfiguration.r2.hasSecretAccessKey ? <button className="danger" onClick={() => setBackupForm({ ...backupForm, clearR2Credentials: true, r2AccessKeyId: "", r2SecretAccessKey: "", r2Enabled: false })} type="button">清除凭证</button> : null}</div>
          </div>
        </section> : null}

      </div>
    </> : <div className="system-status-empty"><CircleAlert aria-hidden="true" size={22} /><span>暂时无法读取系统状态，请稍后刷新。</span></div>}
    {restoreTarget ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !backupBusy) setRestoreTarget(""); }} role="presentation"><div aria-modal="true" className="modal-panel backup-restore-modal" role="dialog"><div className="modal-heading"><span className="section-label">Database restore</span><h2>恢复数据库</h2><p>恢复会覆盖当前数据库，系统会先自动创建一份恢复前备份。请输入完整文件名确认。</p></div><label className="backup-confirm-field"><span>{restoreTarget}</span><input autoFocus onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder="输入上方完整文件名" value={restoreConfirmation} /></label><div className="actions"><button className="button" disabled={restoreConfirmation !== restoreTarget || Boolean(backupBusy)} onClick={() => void handleRestoreBackup()} type="button">{backupBusy ? "恢复中" : "确认恢复"}</button><button className="button secondary" disabled={Boolean(backupBusy)} onClick={() => setRestoreTarget("")} type="button">取消</button></div></div></div> : null}
    {selectedMediaJob ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMediaJob(null); }} role="presentation"><div aria-modal="true" className="modal-panel media-backup-detail-modal" role="dialog">
      <header><span><small>Media backup</small><h2>媒体备份任务 #{selectedMediaJob.id}</h2></span><button aria-label="关闭任务详情" onClick={() => setSelectedMediaJob(null)} title="关闭" type="button"><X aria-hidden="true" size={18} /></button></header>
      <div className="media-backup-detail-summary"><span><small>状态</small><strong className={mediaJobTone(selectedMediaJob.status)}>{mediaJobStatusLabel(selectedMediaJob.status)}</strong></span><span><small>文件</small><strong>{selectedMediaJob.processedFiles} / {selectedMediaJob.totalFiles}</strong></span><span><small>上传流量</small><strong>{formatBytes(selectedMediaJob.uploadedBytes)}</strong></span><span><small>提供商</small><strong>{selectedMediaJob.providers.map(providerLabel).join("、") || "未配置"}</strong></span></div>
      <section><h3>任务日志</h3><div className="media-backup-log-list">{selectedMediaJob.logs.map((log) => <article className={log.level} key={log.id}><time>{formatDateTime(log.createdAt)}</time><span>{log.message}</span></article>)}{!selectedMediaJob.logs.length ? <p>暂无任务日志。</p> : null}</div></section>
      <section><h3>文件清单</h3><div className="media-backup-manifest-list">{selectedMediaJob.manifests.map((manifest) => <article key={manifest.id}><span><strong title={manifest.storedName}>{manifest.storedName}</strong><small>{providerLabel(manifest.provider)} · {formatBytes(manifest.sizeBytes)}</small></span><i className={mediaManifestTone(manifest.status)}>{mediaManifestStatusLabel(manifest.status)}</i></article>)}{!selectedMediaJob.manifests.length ? <p>任务尚未生成文件清单。</p> : null}</div></section>
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

function TrendChart({ detail, formatter, label, points, warningValue }: {
  detail: string;
  formatter: (value: number) => string;
  label: string;
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
    <svg aria-label={`${label}趋势`} preserveAspectRatio="none" role="img" viewBox="0 0 240 64">
      <line x1="0" x2="240" y1="58" y2="58" />
      {line ? <polyline fill="none" points={line} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <footer><span>{values.length ? formatter(minimum) : "暂无数据"}</span><span>{visiblePoints.length > 1 ? formatShortTime(visiblePoints[0].recordedAt) : ""}</span><span>{visiblePoints.length > 1 ? formatShortTime(visiblePoints.at(-1)?.recordedAt ?? "") : ""}</span><span>{values.length ? formatter(maximum) : ""}</span></footer>
  </div>;
}

function MonitoringEventList({ empty, events, title }: {
  empty: string;
  events: SystemStatus["monitoring"]["slowRequests"];
  title: string;
}) {
  return <div className="system-monitoring-events">
    <header><strong>{title}</strong><span>{events.length} 条</span></header>
    {events.length ? <div>{events.map((event, index) => <article key={`${event.occurredAt}-${event.method}-${event.path}-${index}`}>
      <span><b>{event.method}</b><strong title={event.path}>{event.path}</strong></span>
      <span><em>{event.statusCode}</em><em>{event.durationMs.toFixed(1)} ms</em><time>{formatDateTime(event.occurredAt)}</time></span>
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

function formatNullableBytes(value: number | null): string {
  return value === null ? "无法读取" : formatBytes(value);
}

function formatMemoryUsage(used: number | null, max: number | null): string {
  if (used === null) return "无法读取";
  return max && max > 0 ? `${formatBytes(used)} / ${formatBytes(max)}` : formatBytes(used);
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function formatCoverage(value: number | null): string {
  return value === null ? "待生成目录" : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function formatAnomalySummary(anomalies: SystemStatus["reliability"]["anomalies"]): string {
  const details = [
    ["备份失败", anomalies.backupFailures],
    ["磁盘预警", anomalies.diskPressure],
    ["缺失文件", anomalies.missingFiles],
    ["孤立文件", anomalies.orphanFiles],
    ["大小不一致", anomalies.metadataMismatches],
    ["接口错误", anomalies.recentApiErrors],
  ].filter((item): item is [string, number] => Number(item[1]) > 0);

  return details.length ? details.map(([label, count]) => `${label} ${count}`).join(" · ") : "当前未发现异常";
}

function formatBackupSource(value: "media" | "database" | null): string {
  if (value === "media") return "媒体文件备份";
  if (value === "database") return "数据库备份";
  return "等待首次成功任务";
}

function enabledProviderLabel(configuration: BackupConfiguration): string {
  const providers = [
    configuration.oss.enabled ? "OSS" : null,
    configuration.r2.enabled ? "R2" : null,
  ].filter(Boolean);
  return providers.length ? providers.join(" + ") : "未启用";
}

function providerLabel(provider: "oss" | "r2"): string {
  return provider === "oss" ? "阿里云 OSS" : "Cloudflare R2";
}

function mediaJobStatusLabel(status: MediaBackupJob["status"]): string {
  return ({ pending: "等待中", running: "执行中", completed: "已完成", partial: "部分失败", failed: "失败" })[status];
}

function mediaJobTone(status: MediaBackupJob["status"]): string {
  if (status === "completed") return "success";
  if (status === "partial") return "warning";
  if (status === "failed") return "error";
  return "running";
}

function mediaManifestStatusLabel(status: MediaBackupJobDetail["manifests"][number]["status"]): string {
  return ({ pending: "等待中", uploaded: "已上传", reused: "已复用", skipped: "已跳过", failed: "失败" })[status];
}

function mediaManifestTone(status: MediaBackupJobDetail["manifests"][number]["status"]): string {
  if (status === "uploaded" || status === "reused") return "success";
  if (status === "skipped") return "warning";
  if (status === "failed") return "error";
  return "running";
}
