"use client";

import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  FileJson,
  Image as ImageIcon,
  LoaderCircle,
  MonitorSmartphone,
  MoreVertical,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  Share2,
  Smartphone,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import {
  type AndroidRelease,
  getLatestAndroidRelease,
  resolveAndroidReleaseUrl,
} from "@/lib/android-release-api";
import {
  PWA_INSTALL_PROMPT_CHANGE_EVENT,
  getFallbackInstallMessage,
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplay,
  promptPwaInstall,
  readInstallPrompt,
} from "@/lib/pwa-install";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";

type DiagnosticStatus = "ok" | "warn" | "error" | "pending";

interface DiagnosticItem {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: DiagnosticStatus;
}

interface WebManifestIcon {
  src?: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface WebManifestSnapshot {
  name?: string;
  shortName?: string;
  startUrl?: string;
  scope?: string;
  display?: string;
  iconCount: number;
  shortcutCount: number;
}

interface BrowserSnapshot {
  browser: string;
  platform: string;
  mode: string;
  isAndroid: boolean;
  isIos: boolean;
  isChromeLike: boolean;
  isStandalone: boolean;
}

interface StaticAndroidApkRelease {
  versionName: string;
  versionCode: number;
  fileName: string;
  apkUrl: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
  notes: string[];
}

const initialChecks: DiagnosticItem[] = [
  { id: "secure", title: "安全连接", value: "检测中", detail: "正在检查 HTTPS 环境。", status: "pending" },
  { id: "manifest", title: "应用清单", value: "检测中", detail: "正在读取 site.webmanifest。", status: "pending" },
  { id: "icons", title: "应用图标", value: "检测中", detail: "正在检查 192 和 512 图标。", status: "pending" },
  { id: "service-worker", title: "Service Worker", value: "检测中", detail: "正在确认安装生命周期支持。", status: "pending" },
];

const statusCopy: Record<DiagnosticStatus, string> = {
  ok: "正常",
  warn: "注意",
  error: "异常",
  pending: "检测中",
};

const statusIcon = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  pending: LoaderCircle,
};

function detectBrowser(): BrowserSnapshot {
  const ua = window.navigator.userAgent;
  const lowerUa = ua.toLowerCase();
  const isAndroid = isAndroidDevice();
  const isIos = isIosDevice();
  const isStandalone = isStandaloneDisplay();
  const isSamsung = lowerUa.includes("samsungbrowser");
  const isEdge = lowerUa.includes("edg/");
  const isChromeLike = lowerUa.includes("chrome/") || lowerUa.includes("crios/") || lowerUa.includes("chromium/");
  const browser = isSamsung
    ? "Samsung Internet"
    : isEdge
      ? "Edge"
      : isChromeLike
        ? "Chrome"
        : lowerUa.includes("firefox") || lowerUa.includes("fxios")
          ? "Firefox"
          : lowerUa.includes("safari")
            ? "Safari"
            : "当前浏览器";

  return {
    browser,
    platform: isAndroid ? "Android" : isIos ? "iOS / iPadOS" : window.navigator.platform || "未知设备",
    mode: isStandalone ? "独立窗口" : "浏览器页面",
    isAndroid,
    isIos,
    isChromeLike,
    isStandalone,
  };
}

async function checkUrl(url: string) {
  const response = await fetchWithTimeout(url, { cache: "no-store" }, 4200);
  return response.ok;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5200) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function resolveManifestIcon(icon: WebManifestIcon) {
  if (!icon.src) return null;
  return new URL(icon.src, window.location.href).href;
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatReleaseTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getInstallCheck(browser: BrowserSnapshot | null, hasInstallPrompt: boolean): DiagnosticItem {
  if (!browser) {
    return {
      id: "native-install",
      title: "原生安装窗口",
      value: "检测中",
      detail: "正在等待浏览器安装事件。",
      status: "pending",
    };
  }
  if (browser.isStandalone) {
    return {
      id: "native-install",
      title: "原生安装窗口",
      value: "已安装",
      detail: "当前已经以独立窗口方式打开。",
      status: "ok",
    };
  }
  if (hasInstallPrompt) {
    return {
      id: "native-install",
      title: "原生安装窗口",
      value: "可以安装",
      detail: "Chrome 已开放安装弹窗，可以直接点击安装。",
      status: "ok",
    };
  }
  if (browser.isIos) {
    return {
      id: "native-install",
      title: "原生安装窗口",
      value: "需手动添加",
      detail: "iPhone/iPad 不会弹出安装窗口，需要通过 Safari 分享菜单添加到主屏幕。",
      status: "warn",
    };
  }
  if (browser.isAndroid && browser.isChromeLike) {
    return {
      id: "native-install",
      title: "原生安装窗口",
      value: "等待 Chrome 开放",
      detail: "基础条件正常后，Chrome 可能需要刷新、停留或用户点击后才显示安装入口。",
      status: "warn",
    };
  }
  return {
    id: "native-install",
    title: "原生安装窗口",
    value: "浏览器限制",
    detail: "当前浏览器可能不支持直接安装 PWA，建议换 Chrome 或 Safari。",
    status: "warn",
  };
}

export function PwaDiagnostics() {
  const [browser, setBrowser] = useState<BrowserSnapshot | null>(null);
  const [checks, setChecks] = useState<DiagnosticItem[]>(initialChecks);
  const [manifest, setManifest] = useState<WebManifestSnapshot | null>(null);
  const [androidRelease, setAndroidRelease] = useState<AndroidRelease | StaticAndroidApkRelease | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [hasInstallPrompt, setHasInstallPrompt] = useState(false);
  const [hasGesture, setHasGesture] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setChecks(initialChecks);
    const next: DiagnosticItem[] = [];

    const isSecure = window.location.protocol === "https:"
      || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    next.push({
      id: "secure",
      title: "安全连接",
      value: isSecure ? "HTTPS 正常" : "不是 HTTPS",
      detail: isSecure ? "当前页面满足 PWA 对安全上下文的要求。" : "PWA 安装需要 HTTPS，localhost 调试除外。",
      status: isSecure ? "ok" : "error",
    });

    let manifestData: {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: WebManifestIcon[];
      shortcuts?: unknown[];
    } | null = null;
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const manifestUrl = new URL(manifestLink?.href || "/site.webmanifest", window.location.href).href;

    try {
      const response = await fetchWithTimeout(`${manifestUrl}${manifestUrl.includes("?") ? "&" : "?"}diagnostics=${Date.now()}`, { cache: "no-store" });
      manifestData = await response.json();
      const hasName = Boolean(manifestData?.name || manifestData?.short_name);
      const display = manifestData?.display ?? "";
      const displayOk = ["standalone", "fullscreen", "minimal-ui"].includes(display);
      const startUrlOk = Boolean(manifestData?.start_url);
      setManifest({
        name: manifestData?.name,
        shortName: manifestData?.short_name,
        startUrl: manifestData?.start_url,
        scope: manifestData?.scope,
        display,
        iconCount: manifestData?.icons?.length ?? 0,
        shortcutCount: manifestData?.shortcuts?.length ?? 0,
      });
      next.push({
        id: "manifest",
        title: "应用清单",
        value: hasName && displayOk && startUrlOk ? "清单正常" : "清单不完整",
        detail: `已读取 ${manifestUrl.replace(window.location.origin, "")}，display=${display || "未设置"}。`,
        status: hasName && displayOk && startUrlOk ? "ok" : "error",
      });
    } catch {
      setManifest(null);
      next.push({
        id: "manifest",
        title: "应用清单",
        value: "读取失败",
        detail: "浏览器没有成功读取 site.webmanifest。",
        status: "error",
      });
    }

    if (manifestData?.icons?.length) {
      const icons = manifestData.icons;
      const icon192 = icons.find((icon) => icon.sizes?.includes("192"));
      const icon512 = icons.find((icon) => icon.sizes?.includes("512"));
      const iconUrls = [icon192, icon512].flatMap((icon) => {
        const iconUrl = icon ? resolveManifestIcon(icon) : null;
        return iconUrl ? [iconUrl] : [];
      });
      const iconResults = await Promise.all(iconUrls.map((url) => checkUrl(url).catch(() => false)));
      const hasRequiredIconConfig = Boolean(icon192 && icon512);
      const iconsOk = Boolean(hasRequiredIconConfig && iconResults.every(Boolean));
      next.push({
        id: "icons",
        title: "应用图标",
        value: iconsOk ? "图标正常" : hasRequiredIconConfig ? "访问超时" : "图标缺失",
        detail: iconsOk
          ? "192 和 512 图标都可以访问。"
          : hasRequiredIconConfig
            ? "manifest 已配置 192 和 512 图标，但浏览器这次没有及时读取成功。"
            : "需要同时提供可访问的 192 和 512 图标。",
        status: iconsOk ? "ok" : hasRequiredIconConfig ? "warn" : "error",
      });
    } else {
      next.push({
        id: "icons",
        title: "应用图标",
        value: "未配置图标",
        detail: "manifest 中没有发现图标配置。",
        status: "error",
      });
    }

    if (!("serviceWorker" in navigator)) {
      next.push({
        id: "service-worker",
        title: "Service Worker",
        value: "不支持",
        detail: "当前浏览器不支持 Service Worker。",
        status: "error",
      });
    } else {
      try {
        const existing = await withTimeout(navigator.serviceWorker.getRegistration("/"), 2600, "service worker registration timeout");
        const registration = existing ?? await withTimeout(navigator.serviceWorker.register("/sw.js", { scope: "/" }), 4200, "service worker register timeout");
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => window.setTimeout(resolve, 2400)),
        ]);
        const active = Boolean(registration.active || registration.waiting || registration.installing);
        next.push({
          id: "service-worker",
          title: "Service Worker",
          value: active ? "已注册" : "注册中",
          detail: navigator.serviceWorker.controller
            ? "Service Worker 已接管当前页面。"
            : "Service Worker 已注册，刷新后会接管当前页面。",
          status: active ? "ok" : "warn",
        });
      } catch {
        next.push({
          id: "service-worker",
          title: "Service Worker",
          value: "检测超时",
          detail: "浏览器没有及时返回 Service Worker 状态，可以刷新后重试。",
          status: "warn",
        });
      }
    }

    setChecks(next);
    setHasInstallPrompt(Boolean(readInstallPrompt()));
    setIsRunning(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowser(detectBrowser());
    void runDiagnostics();

    function handlePromptChange() {
      setHasInstallPrompt(Boolean(readInstallPrompt()));
    }
    function handleGesture() {
      setHasGesture(true);
    }

    window.addEventListener(PWA_INSTALL_PROMPT_CHANGE_EVENT, handlePromptChange);
    window.addEventListener("pointerdown", handleGesture, { once: true });
    window.addEventListener("keydown", handleGesture, { once: true });
    return () => {
      window.removeEventListener(PWA_INSTALL_PROMPT_CHANGE_EVENT, handlePromptChange);
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("keydown", handleGesture);
    };
  }, [runDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    getPublicSiteSettings()
      .then((settings) => {
        if (!cancelled) setSiteSettings(settings);
      })
      .catch(() => undefined);
    getLatestAndroidRelease()
      .then(async (release) => {
        if (release) {
          return release;
        }

        const response = await fetch("/downloads/android/latest.json", { cache: "no-store" });
        return response.ok ? response.json() as Promise<StaticAndroidApkRelease> : null;
      })
      .then((release) => {
        if (!cancelled) setAndroidRelease(release);
      })
      .catch(() => {
        fetch("/downloads/android/latest.json", { cache: "no-store" })
          .then((response) => response.ok ? response.json() as Promise<StaticAndroidApkRelease> : null)
          .then((release) => {
            if (!cancelled) setAndroidRelease(release);
          })
          .catch(() => {
            if (!cancelled) setAndroidRelease(null);
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const renderedChecks = useMemo(() => [
    ...checks,
    getInstallCheck(browser, hasInstallPrompt),
  ], [browser, checks, hasInstallPrompt]);

  const readyCount = renderedChecks.filter((item) => item.status === "ok").length;
  const blockerCount = renderedChecks.filter((item) => item.status === "error").length;
  const canPromptInstall = hasInstallPrompt && !browser?.isStandalone;

  if (siteSettings && !siteSettings.installPageEnabled) {
    return (
      <section className="page-shell install-page">
        <div className="install-hero">
          <div>
            <span className="section-label">Install</span>
            <h1>{siteSettings.siteName} 暂未开放安装入口</h1>
            <p>当前站点关闭了 PWA 安装诊断和 Android APK 下载入口。</p>
          </div>
          <div className="install-score" data-state="warn">
            <strong>OFF</strong>
            <span>已关闭</span>
          </div>
        </div>
        <div className="install-actions-panel">
          <Link className="text-action primary" href="/">返回首页</Link>
        </div>
      </section>
    );
  }

  async function handleInstall() {
    if (canPromptInstall) {
      const choice = await promptPwaInstall();
      setHasInstallPrompt(Boolean(readInstallPrompt()));
      if (!choice) {
        setNotice("安装窗口暂时不可用，请刷新后再试。");
        return;
      }
      setNotice(choice.outcome === "accepted" ? "HLOVET 已开始安装。" : "安装已取消。");
      return;
    }
    setIsGuideOpen(true);
    setNotice(getFallbackInstallMessage(Boolean(browser?.isIos), Boolean(browser?.isAndroid)));
  }

  return (
    <section className="page-shell install-page">
      <div className="install-hero">
        <div>
          <span className="section-label">PWA 安装诊断</span>
          <h1>检查当前浏览器能不能安装 HLOVET</h1>
          <p>这里会直接读取当前页面环境，判断 Chrome 或 Safari 为什么还没有出现安装入口。</p>
        </div>
        <div className="install-score" data-state={blockerCount ? "error" : readyCount >= 4 ? "ok" : "warn"}>
          <strong>{readyCount}/{renderedChecks.length}</strong>
          <span>{blockerCount ? "存在阻断项" : readyCount >= 4 ? "基础条件正常" : "等待浏览器开放"}</span>
        </div>
      </div>

      <div className="install-actions-panel">
        <button className="button install-primary-action" disabled={browser?.isStandalone} onClick={() => void handleInstall()} type="button">
          <AppWindow aria-hidden="true" size={17} />
          <span>{canPromptInstall ? "立即安装" : browser?.isStandalone ? "已安装" : "查看安装方式"}</span>
        </button>
        <a className="button install-apk-action" download={androidRelease?.fileName ?? true} href={getAndroidReleaseDownloadUrl(androidRelease)}>
          <PackagePlus aria-hidden="true" size={17} />
          <span>下载 Android APK</span>
        </a>
        <button className="text-action" disabled={isRunning} onClick={() => void runDiagnostics()} type="button">
          <RefreshCw aria-hidden="true" className={isRunning ? "spin" : undefined} size={16} />
          重新检测
        </button>
        <Link className="text-action" href="/">返回首页</Link>
      </div>

      <div className="install-summary-grid">
        <div className="install-mini-card">
          <Smartphone aria-hidden="true" size={20} />
          <span>设备</span>
          <strong>{browser ? browser.platform : "检测中"}</strong>
        </div>
        <div className="install-mini-card">
          <MonitorSmartphone aria-hidden="true" size={20} />
          <span>浏览器</span>
          <strong>{browser ? browser.browser : "检测中"}</strong>
        </div>
        <div className="install-mini-card">
          <ShieldCheck aria-hidden="true" size={20} />
          <span>打开方式</span>
          <strong>{browser ? browser.mode : "检测中"}</strong>
        </div>
        <div className="install-mini-card">
          <FileJson aria-hidden="true" size={20} />
          <span>清单</span>
          <strong>{manifest?.display ?? "读取中"}</strong>
        </div>
        <div className="install-mini-card">
          <PackagePlus aria-hidden="true" size={20} />
          <span>APK</span>
          <strong>{androidRelease ? `v${androidRelease.versionName}` : "读取中"}</strong>
        </div>
      </div>

      <div className="install-layout">
        <div className="install-panel">
          <div className="install-panel-head">
            <strong>诊断结果</strong>
            <span>{hasGesture ? "已检测到页面点击" : elapsedSeconds >= 30 ? "已停留 30 秒以上" : `已停留 ${elapsedSeconds} 秒`}</span>
          </div>
          <div className="diagnostic-list">
            {renderedChecks.map((item) => {
              const Icon = statusIcon[item.status];
              return (
                <article className="diagnostic-item" data-state={item.status} key={item.id}>
                  <span className="diagnostic-icon"><Icon aria-hidden="true" className={item.status === "pending" ? "spin" : undefined} size={18} /></span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <b>{item.value}</b>
                  <em>{statusCopy[item.status]}</em>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="install-panel install-guide-panel">
          <div className="install-panel-head">
            <strong>当前建议</strong>
            <span>{browser?.browser ?? "浏览器"}</span>
          </div>
          {browser?.isAndroid ? (
            <ol className="install-guide-list">
              <li>确认地址栏是 <strong>https://5200918.xyz</strong>，不要在微信或其它内置浏览器里打开。</li>
              <li>点一下页面并停留 30 秒左右，然后刷新一次。</li>
              <li>如果本页显示“可以安装”，点上方“立即安装”。</li>
              <li>如果右上角菜单没有安装项，点菜单里的“分享...”，再在分享面板中找“添加到主屏幕”。</li>
            </ol>
          ) : browser?.isIos ? (
            <ol className="install-guide-list">
              <li>用 Safari 打开本站。</li>
              <li>点击浏览器底部或顶部的分享按钮。</li>
              <li>选择“添加到主屏幕”，确认名称为 HLOVET。</li>
            </ol>
          ) : (
            <ol className="install-guide-list">
              <li>桌面 Chrome 或 Edge 通常会在地址栏右侧显示安装图标。</li>
              <li>如果没有图标，打开浏览器菜单，查找“安装 HLOVET”。</li>
              <li>安装后从系统应用列表或桌面图标打开。</li>
            </ol>
          )}
          <div className="install-note">
            <ImageIcon aria-hidden="true" size={18} />
            <span>PWA 不需要下载 APK；如果浏览器没有安装入口，可以下载 Android APK 手动安装。</span>
          </div>
          {androidRelease ? <div className="install-apk-release">
            <strong>Android APK v{androidRelease.versionName}</strong>
            <span>{formatFileSize(androidRelease.sizeBytes)} · {formatReleaseTime(androidRelease.updatedAt)}</span>
            <small>SHA256 {androidRelease.sha256.slice(0, 12)}...{androidRelease.sha256.slice(-8)}</small>
            {getAndroidReleaseNotes(androidRelease).length ? <ul>{getAndroidReleaseNotes(androidRelease).map((note) => <li key={note}>{note}</li>)}</ul> : null}
          </div> : null}
        </aside>
      </div>

      {isGuideOpen ? <div className="install-guide-backdrop" role="presentation" onClick={() => setIsGuideOpen(false)}>
        <section aria-modal="true" className="install-guide-dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
          <header>
            <strong>安装 HLOVET</strong>
            <button aria-label="关闭安装说明" onClick={() => setIsGuideOpen(false)} type="button"><X aria-hidden="true" size={18} /></button>
          </header>
          {browser?.isAndroid ? <div className="install-guide-steps">
            <article>
              <span><RefreshCw aria-hidden="true" size={18} /></span>
              <strong>先刷新并等待</strong>
              <p>返回首页或当前页，点一下页面，停留 30 秒左右，再刷新一次。</p>
            </article>
            <article>
              <span><MoreVertical aria-hidden="true" size={18} /></span>
              <strong>检查右上角菜单</strong>
              <p>打开 Chrome 右上角三个点，找“安装应用”“安装 HLOVET”或“添加到主屏幕”。</p>
            </article>
            <article>
              <span><Share2 aria-hidden="true" size={18} /></span>
              <strong>菜单没有时点分享</strong>
              <p>如果你的菜单像截图一样没有安装项，点“分享...”，再看分享面板里有没有“添加到主屏幕”。</p>
            </article>
          </div> : browser?.isIos ? <div className="install-guide-steps">
            <article>
              <span><Share2 aria-hidden="true" size={18} /></span>
              <strong>使用 Safari 分享按钮</strong>
              <p>iPhone/iPad 不会弹安装窗口，需要在 Safari 分享菜单中选择“添加到主屏幕”。</p>
            </article>
          </div> : <div className="install-guide-steps">
            <article>
              <span><MoreVertical aria-hidden="true" size={18} /></span>
              <strong>从浏览器菜单安装</strong>
              <p>桌面 Chrome 或 Edge 通常在地址栏或右上角菜单里显示“安装 HLOVET”。</p>
            </article>
          </div>}
          <footer>
            <button className="text-action" onClick={() => { setIsGuideOpen(false); void runDiagnostics(); }} type="button">我已操作，重新检测</button>
            <button className="text-action primary" onClick={() => setIsGuideOpen(false)} type="button">知道了</button>
          </footer>
        </section>
      </div> : null}

      <AppToast duration={4200} message={notice} onDismiss={() => setNotice("")} tone="info" />
    </section>
  );
}

function getAndroidReleaseDownloadUrl(release: AndroidRelease | StaticAndroidApkRelease | null): string {
  if (!release) {
    return "/downloads/android/hlovet-latest.apk";
  }

  if ("apkUrl" in release && release.apkUrl.startsWith("/android-releases/")) {
    return resolveAndroidReleaseUrl(release);
  }

  return release.apkUrl;
}

function getAndroidReleaseNotes(release: AndroidRelease | StaticAndroidApkRelease): string[] {
  return "releaseNotes" in release ? release.releaseNotes : release.notes;
}
