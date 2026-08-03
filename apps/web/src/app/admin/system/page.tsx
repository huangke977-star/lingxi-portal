"use client";

import {
  Activity,
  Archive,
  ArchiveRestore,
  Box,
  CircleAlert,
  CircleCheck,
  Clock3,
  Database,
  Download,
  Files,
  HardDrive,
  RefreshCcw,
  Server,
  Trash2,
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
  getSystemStatus,
  restoreDatabaseBackup,
  type SystemStatus,
} from "@/lib/system-status-api";

export default function SystemStatusPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backupBusy, setBackupBusy] = useState("");
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
        if (user.isSuperAdmin) await loadStatus(token);
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
  }, [loadStatus, router]);

  useEffect(() => {
    if (!accessToken || !currentUser?.isSuperAdmin) return;
    const timer = window.setInterval(() => void loadStatus(accessToken), 30_000);
    return () => window.clearInterval(timer);
  }, [accessToken, currentUser, loadStatus]);

  const largestStorageBytes = useMemo(
    () => Math.max(1, ...(status?.storage.items.map((item) => item.sizeBytes) ?? [1])),
    [status],
  );

  async function refreshAfterBackup(message: string) {
    if (!accessToken) return;
    await loadStatus(accessToken);
    setNotice(message);
  }

  async function handleCreateBackup() {
    if (!accessToken || backupBusy) return;
    setBackupBusy("create");
    setError("");
    try {
      const backup = await createDatabaseBackup(accessToken);
      await refreshAfterBackup(`备份已创建：${backup.name}`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "数据库备份创建失败。");
    } finally {
      setBackupBusy("");
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
        <button aria-label="刷新系统状态" disabled={isRefreshing || !accessToken} onClick={() => accessToken && void loadStatus(accessToken, true)} title="刷新" type="button">
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

        <section className="system-status-panel runtime">
          <PanelHeading icon={Server} title="容器与宿主机" />
          <div className="system-runtime-note"><CircleAlert aria-hidden="true" size={20} /><p>{status.containerRuntime.message}</p></div>
          <div className="system-runtime-links"><span>容器启停、CPU、整机内存和磁盘清理由 1Panel 或 SSH 负责。</span><Link href="/admin/cache">查看 Redis 缓存</Link><Link href="/admin/settings">查看站点资源</Link></div>
        </section>
      </div>
    </> : <div className="system-status-empty"><CircleAlert aria-hidden="true" size={22} /><span>暂时无法读取系统状态，请稍后刷新。</span></div>}
    {restoreTarget ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !backupBusy) setRestoreTarget(""); }} role="presentation"><div aria-modal="true" className="modal-panel backup-restore-modal" role="dialog"><div className="modal-heading"><span className="section-label">Database restore</span><h2>恢复数据库</h2><p>恢复会覆盖当前数据库，系统会先自动创建一份恢复前备份。请输入完整文件名确认。</p></div><label className="backup-confirm-field"><span>{restoreTarget}</span><input autoFocus onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder="输入上方完整文件名" value={restoreConfirmation} /></label><div className="actions"><button className="button" disabled={restoreConfirmation !== restoreTarget || Boolean(backupBusy)} onClick={() => void handleRestoreBackup()} type="button">{backupBusy ? "恢复中" : "确认恢复"}</button><button className="button secondary" disabled={Boolean(backupBusy)} onClick={() => setRestoreTarget("")} type="button">取消</button></div></div></div> : null}
  </section>;
}

function OverviewItem({ icon: Icon, label, value, detail, tone }: { icon: typeof Activity; label: string; value: string; detail: string; tone: "ok" | "error" | "neutral" }) {
  return <div className={`system-overview-item ${tone}`}><span><Icon aria-hidden="true" size={18} /></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function PanelHeading({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return <header className="system-panel-heading"><Icon aria-hidden="true" size={17} /><strong>{title}</strong></header>;
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="system-status-line"><span>{ok ? <CircleCheck aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}<small>{label}</small></span><strong title={value}>{value}</strong></div>;
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
