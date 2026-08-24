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
import { useLanguage } from "@/components/language-provider";
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
import { localizedPath } from "@/lib/i18n";

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

type Phrase = (chinese: string, english: string) => string;

function createInitialChecks(phrase: Phrase): DiagnosticItem[] {
  return [
    { id: "secure", title: phrase("安全连接", "Secure connection"), value: phrase("检测中", "Checking"), detail: phrase("正在检查 HTTPS 环境。", "Checking the HTTPS environment."), status: "pending" },
    { id: "manifest", title: phrase("应用清单", "App manifest"), value: phrase("检测中", "Checking"), detail: phrase("正在读取 manifest.webmanifest。", "Reading manifest.webmanifest."), status: "pending" },
    { id: "icons", title: phrase("应用图标", "App icons"), value: phrase("检测中", "Checking"), detail: phrase("正在检查 192 和 512 图标。", "Checking the 192 and 512 icons."), status: "pending" },
    { id: "service-worker", title: "Service Worker", value: phrase("检测中", "Checking"), detail: phrase("正在确认安装生命周期支持。", "Checking installation lifecycle support."), status: "pending" },
  ];
}

function statusLabel(status: DiagnosticStatus, phrase: Phrase): string {
  return ({
    ok: phrase("正常", "Ready"),
    warn: phrase("注意", "Attention"),
    error: phrase("异常", "Issue"),
    pending: phrase("检测中", "Checking"),
  })[status];
}

const statusIcon = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  pending: LoaderCircle,
};

function detectBrowser(phrase: Phrase): BrowserSnapshot {
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
            : phrase("当前浏览器", "Current browser");

  return {
    browser,
    platform: isAndroid ? "Android" : isIos ? "iOS / iPadOS" : window.navigator.platform || phrase("未知设备", "Unknown device"),
    mode: isStandalone ? phrase("独立窗口", "Standalone window") : phrase("浏览器页面", "Browser tab"),
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

function formatFileSize(sizeBytes: number, phrase: Phrase) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return phrase("未知大小", "Unknown size");
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatReleaseTime(value: string, locale: "zh-CN" | "en-US", phrase: Phrase) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return phrase("未知时间", "Unknown time");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getInstallCheck(browser: BrowserSnapshot | null, hasInstallPrompt: boolean, phrase: Phrase): DiagnosticItem {
  if (!browser) {
    return {
      id: "native-install",
      title: phrase("原生安装窗口", "Native install prompt"),
      value: phrase("检测中", "Checking"),
      detail: phrase("正在等待浏览器安装事件。", "Waiting for the browser install event."),
      status: "pending",
    };
  }
  if (browser.isStandalone) {
    return {
      id: "native-install",
      title: phrase("原生安装窗口", "Native install prompt"),
      value: phrase("已安装", "Installed"),
      detail: phrase("当前已经以独立窗口方式打开。", "This site is already open as a standalone app."),
      status: "ok",
    };
  }
  if (hasInstallPrompt) {
    return {
      id: "native-install",
      title: phrase("原生安装窗口", "Native install prompt"),
      value: phrase("可以安装", "Ready to install"),
      detail: phrase("Chrome 已开放安装弹窗，可以直接点击安装。", "Chrome has made the install prompt available."),
      status: "ok",
    };
  }
  if (browser.isIos) {
    return {
      id: "native-install",
      title: phrase("原生安装窗口", "Native install prompt"),
      value: phrase("需手动添加", "Add manually"),
      detail: phrase("iPhone/iPad 不会弹出安装窗口，需要通过 Safari 分享菜单添加到主屏幕。", "iPhone and iPad require adding the site from Safari's Share menu."),
      status: "warn",
    };
  }
  if (browser.isAndroid && browser.isChromeLike) {
    return {
      id: "native-install",
      title: phrase("原生安装窗口", "Native install prompt"),
      value: phrase("等待 Chrome 开放", "Waiting for Chrome"),
      detail: phrase("基础条件正常后，Chrome 可能需要刷新、停留或用户点击后才显示安装入口。", "Chrome may require a refresh, time on page, or a user gesture before it offers installation."),
      status: "warn",
    };
  }
  return {
    id: "native-install",
    title: phrase("原生安装窗口", "Native install prompt"),
    value: phrase("浏览器限制", "Browser limitation"),
    detail: phrase("当前浏览器可能不支持直接安装 PWA，建议换 Chrome 或 Safari。", "This browser may not support direct PWA installation. Try Chrome or Safari."),
    status: "warn",
  };
}

export function PwaDiagnostics() {
  const { locale, phrase } = useLanguage();
  const [browser, setBrowser] = useState<BrowserSnapshot | null>(null);
  const [checks, setChecks] = useState<DiagnosticItem[]>(() => createInitialChecks(phrase));
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
    setChecks(createInitialChecks(phrase));
    const next: DiagnosticItem[] = [];

    const isSecure = window.location.protocol === "https:"
      || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    next.push({
      id: "secure",
      title: phrase("安全连接", "Secure connection"),
      value: isSecure ? phrase("HTTPS 正常", "HTTPS ready") : phrase("不是 HTTPS", "Not HTTPS"),
      detail: isSecure ? phrase("当前页面满足 PWA 对安全上下文的要求。", "This page meets PWA secure-context requirements.") : phrase("PWA 安装需要 HTTPS，localhost 调试除外。", "PWA installation requires HTTPS, except on localhost."),
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
    const manifestUrl = new URL(manifestLink?.href || "/manifest.webmanifest", window.location.href).href;

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
        title: phrase("应用清单", "App manifest"),
        value: hasName && displayOk && startUrlOk ? phrase("清单正常", "Manifest ready") : phrase("清单不完整", "Manifest incomplete"),
        detail: phrase(`已读取 ${manifestUrl.replace(window.location.origin, "")}，display=${display || "未设置"}。`, `Read ${manifestUrl.replace(window.location.origin, "")}, display=${display || "not set"}.`),
        status: hasName && displayOk && startUrlOk ? "ok" : "error",
      });
    } catch {
      setManifest(null);
      next.push({
        id: "manifest",
        title: phrase("应用清单", "App manifest"),
        value: phrase("读取失败", "Could not read"),
        detail: phrase("浏览器没有成功读取 manifest.webmanifest。", "The browser could not read manifest.webmanifest."),
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
        title: phrase("应用图标", "App icons"),
        value: iconsOk ? phrase("图标正常", "Icons ready") : hasRequiredIconConfig ? phrase("访问超时", "Access timed out") : phrase("图标缺失", "Icons missing"),
        detail: iconsOk
          ? phrase("192 和 512 图标都可以访问。", "Both 192 and 512 icons are reachable.")
          : hasRequiredIconConfig
            ? phrase("manifest 已配置 192 和 512 图标，但浏览器这次没有及时读取成功。", "The manifest defines both icons, but the browser did not retrieve them in time.")
            : phrase("需要同时提供可访问的 192 和 512 图标。", "Both reachable 192 and 512 icons are required."),
        status: iconsOk ? "ok" : hasRequiredIconConfig ? "warn" : "error",
      });
    } else {
      next.push({
        id: "icons",
        title: phrase("应用图标", "App icons"),
        value: phrase("未配置图标", "No icon configuration"),
        detail: phrase("manifest 中没有发现图标配置。", "No icon configuration was found in the manifest."),
        status: "error",
      });
    }

    if (!("serviceWorker" in navigator)) {
      next.push({
        id: "service-worker",
        title: "Service Worker",
        value: phrase("不支持", "Unsupported"),
        detail: phrase("当前浏览器不支持 Service Worker。", "This browser does not support Service Worker."),
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
          value: active ? phrase("已注册", "Registered") : phrase("注册中", "Registering"),
          detail: navigator.serviceWorker.controller
            ? phrase("Service Worker 已接管当前页面。", "Service Worker controls the current page.")
            : phrase("Service Worker 已注册，刷新后会接管当前页面。", "Service Worker is registered and will control the page after refresh."),
          status: active ? "ok" : "warn",
        });
      } catch {
        next.push({
          id: "service-worker",
          title: "Service Worker",
          value: phrase("检测超时", "Check timed out"),
          detail: phrase("浏览器没有及时返回 Service Worker 状态，可以刷新后重试。", "The browser did not return Service Worker status in time. Refresh and try again."),
          status: "warn",
        });
      }
    }

    setChecks(next);
    setHasInstallPrompt(Boolean(readInstallPrompt()));
    setIsRunning(false);
  }, [phrase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowser(detectBrowser(phrase));
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
  }, [phrase, runDiagnostics]);

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
    getInstallCheck(browser, hasInstallPrompt, phrase),
  ], [browser, checks, hasInstallPrompt, phrase]);

  const readyCount = renderedChecks.filter((item) => item.status === "ok").length;
  const blockerCount = renderedChecks.filter((item) => item.status === "error").length;
  const canPromptInstall = hasInstallPrompt && !browser?.isStandalone;

  if (siteSettings && !siteSettings.installPageEnabled) {
    return (
      <section className="page-shell install-page">
        <div className="install-hero">
          <div>
            <span className="section-label">Install</span>
            <h1>{phrase(`${siteSettings.siteName} 暂未开放安装入口`, `${siteSettings.siteName} installation is unavailable`)}</h1>
            <p>{phrase("当前站点关闭了 PWA 安装诊断和 Android APK 下载入口。", "This site has disabled PWA diagnostics and Android APK downloads.")}</p>
          </div>
          <div className="install-score" data-state="warn">
            <strong>OFF</strong>
            <span>{phrase("已关闭", "Disabled")}</span>
          </div>
        </div>
        <div className="install-actions-panel">
          <Link className="text-action primary" href={localizedPath("/", locale)}>{phrase("返回首页", "Back to home")}</Link>
        </div>
      </section>
    );
  }

  async function handleInstall() {
    if (canPromptInstall) {
      const choice = await promptPwaInstall();
      setHasInstallPrompt(Boolean(readInstallPrompt()));
      if (!choice) {
        setNotice(phrase("安装窗口暂时不可用，请刷新后再试。", "The install prompt is unavailable. Refresh and try again."));
        return;
      }
      setNotice(choice.outcome === "accepted" ? phrase("HLOVET 已开始安装。", "HLOVET installation has started.") : phrase("安装已取消。", "Installation was cancelled."));
      return;
    }
    setIsGuideOpen(true);
    setNotice(phrase(
      getFallbackInstallMessage(Boolean(browser?.isIos), Boolean(browser?.isAndroid)),
      browser?.isIos ? "Use Safari's Share menu to add HLOVET to your Home Screen." : browser?.isAndroid ? "Use your browser menu to install HLOVET or add it to your Home Screen." : "Use your browser menu to install HLOVET.",
    ));
  }

  return (
    <section className="page-shell install-page">
      <div className="install-hero">
        <div>
          <span className="section-label">{phrase("PWA 安装诊断", "PWA INSTALL DIAGNOSTICS")}</span>
          <h1>{phrase("检查当前浏览器能不能安装 HLOVET", "Check whether this browser can install HLOVET")}</h1>
          <p>{phrase("这里会直接读取当前页面环境，判断 Chrome 或 Safari 为什么还没有出现安装入口。", "This page reads the current browser environment to explain why Chrome or Safari has not offered installation yet.")}</p>
        </div>
        <div className="install-score" data-state={blockerCount ? "error" : readyCount >= 4 ? "ok" : "warn"}>
          <strong>{readyCount}/{renderedChecks.length}</strong>
          <span>{blockerCount ? phrase("存在阻断项", "Blocked") : readyCount >= 4 ? phrase("基础条件正常", "Base requirements ready") : phrase("等待浏览器开放", "Waiting for browser")}</span>
        </div>
      </div>

      <div className="install-actions-panel">
        <button className="button install-primary-action" disabled={browser?.isStandalone} onClick={() => void handleInstall()} type="button">
          <AppWindow aria-hidden="true" size={17} />
          <span>{canPromptInstall ? phrase("立即安装", "Install now") : browser?.isStandalone ? phrase("已安装", "Installed") : phrase("查看安装方式", "View install steps")}</span>
        </button>
        <a className="button install-apk-action" download={androidRelease?.fileName ?? true} href={getAndroidReleaseDownloadUrl(androidRelease)}>
          <PackagePlus aria-hidden="true" size={17} />
          <span>{phrase("下载 Android APK", "Download Android APK")}</span>
        </a>
        <button className="text-action" disabled={isRunning} onClick={() => void runDiagnostics()} type="button">
          <RefreshCw aria-hidden="true" className={isRunning ? "spin" : undefined} size={16} />
          {phrase("重新检测", "Run checks again")}
        </button>
        <Link className="text-action" href={localizedPath("/", locale)}>{phrase("返回首页", "Back to home")}</Link>
      </div>

      <div className="install-summary-grid">
        <div className="install-mini-card">
          <Smartphone aria-hidden="true" size={20} />
          <span>{phrase("设备", "Device")}</span>
          <strong>{browser ? browser.platform : phrase("检测中", "Checking")}</strong>
        </div>
        <div className="install-mini-card">
          <MonitorSmartphone aria-hidden="true" size={20} />
          <span>{phrase("浏览器", "Browser")}</span>
          <strong>{browser ? browser.browser : phrase("检测中", "Checking")}</strong>
        </div>
        <div className="install-mini-card">
          <ShieldCheck aria-hidden="true" size={20} />
          <span>{phrase("打开方式", "Open mode")}</span>
          <strong>{browser ? browser.mode : phrase("检测中", "Checking")}</strong>
        </div>
        <div className="install-mini-card">
          <FileJson aria-hidden="true" size={20} />
          <span>{phrase("清单", "Manifest")}</span>
          <strong>{manifest?.display ?? phrase("读取中", "Loading")}</strong>
        </div>
        <div className="install-mini-card">
          <PackagePlus aria-hidden="true" size={20} />
          <span>APK</span>
          <strong>{androidRelease ? `v${androidRelease.versionName}` : phrase("读取中", "Loading")}</strong>
        </div>
      </div>

      <div className="install-layout">
        <div className="install-panel">
          <div className="install-panel-head">
            <strong>{phrase("诊断结果", "Diagnostic results")}</strong>
            <span>{hasGesture ? phrase("已检测到页面点击", "Page interaction detected") : elapsedSeconds >= 30 ? phrase("已停留 30 秒以上", "On page for over 30 seconds") : phrase(`已停留 ${elapsedSeconds} 秒`, `On page for ${elapsedSeconds} seconds`)}</span>
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
                  <em>{statusLabel(item.status, phrase)}</em>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="install-panel install-guide-panel">
          <div className="install-panel-head">
            <strong>{phrase("当前建议", "Recommended steps")}</strong>
            <span>{browser?.browser ?? phrase("浏览器", "Browser")}</span>
          </div>
          {browser?.isAndroid ? (
            <ol className="install-guide-list">
              <li>{phrase("确认地址栏是 ", "Confirm the address bar shows ")}<strong>https://5200918.xyz</strong>{phrase("，不要在微信或其它内置浏览器里打开。", ". Do not open it in an in-app browser.")}</li>
              <li>{phrase("点一下页面并停留 30 秒左右，然后刷新一次。", "Interact with the page, wait about 30 seconds, then refresh once.")}</li>
              <li>{phrase("如果本页显示“可以安装”，点上方“立即安装”。", "If this page says it is ready, choose Install now above.")}</li>
              <li>{phrase("如果右上角菜单没有安装项，点菜单里的“分享...”，再在分享面板中找“添加到主屏幕”。", "If the menu has no install item, open Share and look for Add to Home Screen.")}</li>
            </ol>
          ) : browser?.isIos ? (
            <ol className="install-guide-list">
              <li>{phrase("用 Safari 打开本站。", "Open this site in Safari.")}</li>
              <li>{phrase("点击浏览器底部或顶部的分享按钮。", "Use the Share button at the bottom or top of the browser.")}</li>
              <li>{phrase("选择“添加到主屏幕”，确认名称为 HLOVET。", "Choose Add to Home Screen and confirm the name HLOVET.")}</li>
            </ol>
          ) : (
            <ol className="install-guide-list">
              <li>{phrase("桌面 Chrome 或 Edge 通常会在地址栏右侧显示安装图标。", "Desktop Chrome or Edge normally shows an install icon to the right of the address bar.")}</li>
              <li>{phrase("如果没有图标，打开浏览器菜单，查找“安装 HLOVET”。", "If there is no icon, open the browser menu and look for Install HLOVET.")}</li>
              <li>{phrase("安装后从系统应用列表或桌面图标打开。", "Open it after installation from the app list or desktop icon.")}</li>
            </ol>
          )}
          <div className="install-note">
            <ImageIcon aria-hidden="true" size={18} />
            <span>{phrase("PWA 不需要下载 APK；如果浏览器没有安装入口，可以下载 Android APK 手动安装。", "A PWA does not require an APK. If the browser has no install option, you can download the Android APK instead.")}</span>
          </div>
          {androidRelease ? <div className="install-apk-release">
            <strong>Android APK v{androidRelease.versionName}</strong>
            <span>{formatFileSize(androidRelease.sizeBytes, phrase)} · {formatReleaseTime(androidRelease.updatedAt, locale, phrase)}</span>
            <small>SHA256 {androidRelease.sha256.slice(0, 12)}...{androidRelease.sha256.slice(-8)}</small>
            {getAndroidReleaseNotes(androidRelease).length ? <ul>{getAndroidReleaseNotes(androidRelease).map((note) => <li key={note}>{note}</li>)}</ul> : null}
          </div> : null}
        </aside>
      </div>

      {isGuideOpen ? <div className="install-guide-backdrop" role="presentation" onClick={() => setIsGuideOpen(false)}>
        <section aria-modal="true" className="install-guide-dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
          <header>
            <strong>{phrase("安装 HLOVET", "Install HLOVET")}</strong>
            <button aria-label={phrase("关闭安装说明", "Close installation guide")} onClick={() => setIsGuideOpen(false)} type="button"><X aria-hidden="true" size={18} /></button>
          </header>
          {browser?.isAndroid ? <div className="install-guide-steps">
            <article>
              <span><RefreshCw aria-hidden="true" size={18} /></span>
              <strong>{phrase("先刷新并等待", "Refresh, then wait")}</strong>
              <p>{phrase("返回首页或当前页，点一下页面，停留 30 秒左右，再刷新一次。", "Return here or to the home page, interact with the page, wait about 30 seconds, and refresh.")}</p>
            </article>
            <article>
              <span><MoreVertical aria-hidden="true" size={18} /></span>
              <strong>{phrase("检查右上角菜单", "Check the browser menu")}</strong>
              <p>{phrase("打开 Chrome 右上角三个点，找“安装应用”“安装 HLOVET”或“添加到主屏幕”。", "Open Chrome's menu and look for Install app, Install HLOVET, or Add to Home Screen.")}</p>
            </article>
            <article>
              <span><Share2 aria-hidden="true" size={18} /></span>
              <strong>{phrase("菜单没有时点分享", "Use Share when needed")}</strong>
              <p>{phrase("如果你的菜单像截图一样没有安装项，点“分享...”，再看分享面板里有没有“添加到主屏幕”。", "If the menu has no install item, choose Share and look for Add to Home Screen.")}</p>
            </article>
          </div> : browser?.isIos ? <div className="install-guide-steps">
            <article>
              <span><Share2 aria-hidden="true" size={18} /></span>
              <strong>{phrase("使用 Safari 分享按钮", "Use Safari's Share button")}</strong>
              <p>{phrase("iPhone/iPad 不会弹安装窗口，需要在 Safari 分享菜单中选择“添加到主屏幕”。", "iPhone and iPad do not show an install prompt. Choose Add to Home Screen from Safari's Share menu.")}</p>
            </article>
          </div> : <div className="install-guide-steps">
            <article>
              <span><MoreVertical aria-hidden="true" size={18} /></span>
              <strong>{phrase("从浏览器菜单安装", "Install from the browser menu")}</strong>
              <p>{phrase("桌面 Chrome 或 Edge 通常在地址栏或右上角菜单里显示“安装 HLOVET”。", "Desktop Chrome or Edge normally offers Install HLOVET in the address bar or browser menu.")}</p>
            </article>
          </div>}
          <footer>
            <button className="text-action" onClick={() => { setIsGuideOpen(false); void runDiagnostics(); }} type="button">{phrase("我已操作，重新检测", "I have done this, run checks again")}</button>
            <button className="text-action primary" onClick={() => setIsGuideOpen(false)} type="button">{phrase("知道了", "Got it")}</button>
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
