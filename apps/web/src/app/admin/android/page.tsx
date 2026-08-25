"use client";

import {
  CheckCircle2,
  Download,
  PackagePlus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import {
  type AndroidRelease,
  activateAndroidRelease,
  deleteAndroidRelease,
  listAndroidReleases,
  resolveAndroidReleaseUrl,
  uploadAndroidRelease,
} from "@/lib/android-release-api";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";

const MAX_APK_SIZE = 120 * 1024 * 1024;

export default function AndroidReleaseManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [releases, setReleases] = useState<AndroidRelease[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [channel, setChannel] = useState("stable");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [activateAfterUpload, setActivateAfterUpload] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const nextVersionCode = useMemo(() => {
    const maxVersionCode = releases.reduce((max, release) => Math.max(max, release.versionCode), 0);
    return String(maxVersionCode + 1);
  }, [releases]);

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();

    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }

    async function loadReleases(verifiedToken: string) {
      setError("");
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) {
          return;
        }

        setAccessToken(verifiedToken);
        setCurrentUser(me);
        if (!me.isSuperAdmin) {
          return;
        }

        const nextReleases = await listAndroidReleases(verifiedToken);
        if (isMounted) {
          setReleases(nextReleases);
          setVersionCode(String(nextReleases.reduce((max, release) => Math.max(max, release.versionCode), 0) + 1));
        }
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }

        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : phrase("无法读取安装包。", "Could not load app packages."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReleases(token);
    return () => {
      isMounted = false;
    };
  }, [locale, phrase, router]);

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    if (!file) {
      return;
    }

    if (!versionName.trim()) {
      const guessedVersion = guessVersionName(file.name);
      setVersionName(guessedVersion || nextVersionCode);
    }
    if (!versionCode.trim()) {
      setVersionCode(nextVersionCode);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }
    if (!selectedFile) {
      setError(phrase("请选择 APK 安装包。", "Choose an APK package."));
      setNotice("");
      return;
    }
    if (!selectedFile.name.toLowerCase().endsWith(".apk")) {
      setError(phrase("只能上传 .apk 文件。", "Only .apk files can be uploaded."));
      setNotice("");
      return;
    }
    if (selectedFile.size > MAX_APK_SIZE) {
      setError(phrase(`${selectedFile.name} 超过 120 MB。`, `${selectedFile.name} exceeds 120 MB.`));
      setNotice("");
      return;
    }
    const numericVersionCode = Number(versionCode);
    if (!versionName.trim() || !Number.isInteger(numericVersionCode) || numericVersionCode < 1) {
      setError(phrase("请填写版本名称和大于 0 的版本编码。", "Enter a version name and a version code above 0."));
      setNotice("");
      return;
    }

    setIsUploading(true);
    setError("");
    setNotice("");
    try {
      const release = await uploadAndroidRelease(accessToken, {
        file: selectedFile,
        versionName: versionName.trim(),
        versionCode: numericVersionCode,
        channel: channel.trim() || "stable",
        releaseNotes,
        activate: activateAfterUpload,
      });
      setReleases((current) => [
        release,
        ...current.map((item) => ({ ...item, isActive: release.isActive ? false : item.isActive })),
      ].sort(sortAndroidReleases));
      setSelectedFile(null);
      setVersionName("");
      setVersionCode(String(Math.max(numericVersionCode + 1, Number(nextVersionCode))));
      setReleaseNotes("");
      setNotice(release.isActive ? phrase("安装包已上传并设为最新版。", "Package uploaded and set as latest.") : phrase("安装包已上传。", "Package uploaded."));
      const input = document.getElementById("android-release-file") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : phrase("安装包上传失败。", "Could not upload the package."));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleActivate(release: AndroidRelease) {
    if (!accessToken || release.isActive) {
      return;
    }

    setBusyId(release.id);
    setError("");
    setNotice("");
    try {
      const activeRelease = await activateAndroidRelease(accessToken, release.id);
      setReleases((current) =>
        current.map((item) => ({ ...item, isActive: item.id === activeRelease.id })).sort(sortAndroidReleases),
      );
      setNotice(phrase(`已将 v${activeRelease.versionName} 设为 Android 最新版。`, `v${activeRelease.versionName} is now the latest Android release.`));
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : phrase("安装包切换失败。", "Could not set the latest package."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(release: AndroidRelease) {
    if (!accessToken) {
      return;
    }

    const confirmed = window.confirm(
      release.isActive
        ? phrase("删除当前最新版后，安装页会暂时使用兜底下载包或显示无新版，确定删除吗？", "Deleting the current release makes the install page use its fallback package or show no release. Continue?")
        : phrase(`确定从磁盘中永久删除 ${release.originalName} 吗？`, `Permanently delete ${release.originalName} from disk?`),
    );
    if (!confirmed) {
      return;
    }

    setBusyId(release.id);
    setError("");
    setNotice("");
    try {
      await deleteAndroidRelease(accessToken, release.id);
      setReleases((current) => current.filter((item) => item.id !== release.id));
      setNotice(phrase("安装包及其磁盘文件已删除。", "The package and its file were deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("安装包删除失败。", "Could not delete the package."));
    } finally {
      setBusyId(null);
    }
  }

  const pageDescription = phrase("管理安装页展示的 Android 安装包。", "Manage Android packages shown on the install page.");

  if (isLoading) return <AdminPageLoading className="android-release-admin-shell" description={pageDescription} loadingLabel={phrase("正在读取安装包", "Loading packages")} title={phrase("安装包管理", "Package management")} />;

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无法进入安装包管理", "Could not open package management")}</h1>
        <p>{error || phrase("请重新登录后再访问。", "Sign in again to continue.")}</p>
        <Link className="text-action primary" href={localizedPath("/login", locale)}>
          {phrase("返回登录", "Back to sign in")}
        </Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无权访问", "Access denied")}</h1>
        <p>{phrase("该页面仅超级管理员可查看。", "Only super administrators can view this page.")}</p>
        <Link className="text-action primary" href={localizedPath("/dashboard", locale)}>
          {phrase("返回工作台", "Back to workspace")}
        </Link>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell android-release-admin-shell">
      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />

      <AdminPageHeader description={pageDescription} title={phrase("安装包管理", "Package management")} />
      <form className="android-release-upload-panel" onSubmit={(event) => void handleUpload(event)}>
        <div className="android-release-upload-copy">
          <span className="section-label">Android APK</span>
          <h2>{phrase("上传新版安装包", "Upload a new package")}</h2>
          <p>{phrase("上传后可设为安装页展示的最新版，单个 APK 不超过 120 MB。", "Set an upload as the release shown on the install page. Each APK must be at most 120 MB.")}</p>
        </div>

        <div className="android-release-form-grid">
          <label>
            <span>{phrase("安装包", "Package")}</span>
            <span className="background-file-picker android-release-file-picker">
              <input
                accept=".apk,application/vnd.android.package-archive"
                disabled={isUploading}
                id="android-release-file"
                onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                type="file"
              />
              <span>{selectedFile ? selectedFile.name : phrase("选择 APK 文件", "Choose APK file")}</span>
            </span>
          </label>
          <label>
            <span>{phrase("版本名称", "Version name")}</span>
            <input disabled={isUploading} onChange={(event) => setVersionName(event.target.value)} placeholder={phrase("例如 1.0.2", "For example, 1.0.2")} value={versionName} />
          </label>
          <label>
            <span>{phrase("版本编码", "Version code")}</span>
            <input disabled={isUploading} min={1} onChange={(event) => setVersionCode(event.target.value)} placeholder={nextVersionCode} type="number" value={versionCode} />
          </label>
          <label>
            <span>{phrase("发布通道", "Release channel")}</span>
            <input disabled={isUploading} onChange={(event) => setChannel(event.target.value)} placeholder="stable" value={channel} />
          </label>
          <label className="android-release-notes-field">
            <span>{phrase("更新说明", "Release notes")}</span>
            <textarea disabled={isUploading} onChange={(event) => setReleaseNotes(event.target.value)} placeholder={phrase("每行一条，安装页会展示给用户", "One item per line. They are shown on the install page.")} rows={4} value={releaseNotes} />
          </label>
          <label className="android-release-active-check">
            <input checked={activateAfterUpload} disabled={isUploading} onChange={(event) => setActivateAfterUpload(event.target.checked)} type="checkbox" />
            {phrase("上传后设为最新版", "Set as latest after upload")}
          </label>
          <button className="button android-release-submit" disabled={isUploading || !selectedFile} type="submit">
            {isUploading ? <PackagePlus aria-hidden="true" className="spin" size={17} /> : <Upload aria-hidden="true" size={17} />}
            {isUploading ? phrase("上传中", "Uploading") : phrase("上传安装包", "Upload package")}
          </button>
        </div>
      </form>

      <div className="background-list-heading">
        <div>
          <span className="section-label">{phrase("安装包仓库", "PACKAGE REPOSITORY")}</span>
          <h2>{phrase(`${releases.length} 个已上传版本`, `${releases.length} uploaded releases`)}</h2>
        </div>
        <span className="background-current-state">
          {releases.some((release) => release.isActive) ? phrase("已设置 Android 最新版", "Latest Android release is set") : phrase("使用静态兜底安装包", "Using fallback package")}
        </span>
      </div>

      {releases.length ? (
        <div className="android-release-list">
          {releases.map((release) => {
            const isBusy = busyId === release.id;
            return (
              <article className={`android-release-card${release.isActive ? " active" : ""}`} key={release.id}>
                <div className="android-release-icon">
                  {release.isActive ? <CheckCircle2 aria-hidden="true" size={24} /> : <PackagePlus aria-hidden="true" size={24} />}
                </div>
                <div className="android-release-main">
                  <div className="android-release-title-row">
                    <strong title={release.originalName}>v{release.versionName}</strong>
                    <span>Code {release.versionCode}</span>
                    <em>{release.channel}</em>
                    {release.isActive ? <b>{phrase("当前最新版", "Latest")}</b> : null}
                  </div>
                  <span className="android-release-file-line">{release.originalName}</span>
                  {release.releaseNotes.length ? <p>{release.releaseNotes.join(" / ")}</p> : null}
                  <small>
                    {formatFileSize(release.sizeBytes)} · {formatDate(release.updatedAt, locale)} · SHA256 {release.sha256.slice(0, 12)}...{release.sha256.slice(-8)} · {release.uploadedBy.username}
                  </small>
                </div>
                <div className="android-release-actions">
                  <a className="text-action" href={resolveAndroidReleaseUrl(release)} download={release.fileName}>
                    <Download aria-hidden="true" size={14} />
                    {phrase("下载", "Download")}
                  </a>
                  {!release.isActive ? (
                    <button className="text-action primary" disabled={isBusy} onClick={() => void handleActivate(release)} type="button">
                      <ShieldCheck aria-hidden="true" size={14} />
                      {isBusy ? phrase("设置中", "Setting") : phrase("设为最新版", "Set as latest")}
                    </button>
                  ) : null}
                  <button className="text-action danger-text" disabled={isBusy} onClick={() => void handleDelete(release)} type="button">
                    <Trash2 aria-hidden="true" size={14} />
                    {isBusy ? phrase("处理中", "Processing") : phrase("永久删除", "Delete permanently")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="background-empty-state">
          <strong>{phrase("暂无上传版本", "No uploaded releases")}</strong>
          <p>{phrase("安装页会继续使用内置静态 APK 下载入口。", "The install page will keep using its built-in APK download.")}</p>
        </div>
      )}
    </section>
  );
}

function sortAndroidReleases(left: AndroidRelease, right: AndroidRelease): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }
  if (left.versionCode !== right.versionCode) {
    return right.versionCode - left.versionCode;
  }
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function guessVersionName(fileName: string): string {
  const match = fileName.match(/(?:v|version)?(\d+(?:\.\d+){0,3})/i);
  return match?.[1] ?? "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
