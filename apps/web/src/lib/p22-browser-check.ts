export interface P22BrowserCheckResult {
  id: string;
  label: string;
  labelEn: string;
  status: "passed" | "failed";
  detail: string;
  detailEn: string;
  latencyMs: number;
}

export interface P22BrowserAcceptanceResult {
  generatedAt: string;
  passed: boolean;
  contract: P22BrowserCheckResult[];
  pages: P22BrowserCheckResult[];
}

const CONTRACT_CHECKS = [
  ["api-health", "/api/health", "API 存活", "API liveness"],
  ["api-readiness", "/api/health/ready", "API 就绪", "API readiness"],
  ["sitemap", "/api/distribution/sitemap", "站点地图", "Sitemap"],
  ["rss", "/api/distribution/feeds/site.rss", "RSS", "RSS"],
  ["home", "/", "中文首页", "Chinese home"],
  ["english-home", "/en", "英文首页", "English home"],
  ["manifest", "/manifest.webmanifest", "中文 Manifest", "Chinese manifest"],
  ["english-manifest", "/en/manifest.webmanifest", "英文 Manifest", "English manifest"],
  ["service-worker", "/sw.js", "Service Worker", "Service Worker"],
] as const;

const PUBLIC_PATHS = [
  ["home", "/", "首页", "Home"],
  ["english-home", "/en", "英文首页", "English home"],
  ["articles", "/articles", "文章列表", "Articles"],
  ["english-articles", "/en/articles", "英文文章列表", "English articles"],
  ["topics", "/topics", "专题列表", "Topics"],
  ["english-topics", "/en/topics", "英文专题列表", "English topics"],
  ["collections", "/articles/collections", "合集列表", "Collections"],
  ["english-collections", "/en/articles/collections", "英文合集列表", "English collections"],
] as const;

export async function runP22BrowserAcceptance(): Promise<P22BrowserAcceptanceResult> {
  const contract = await Promise.all(CONTRACT_CHECKS.map(([id, path, label, labelEn]) => checkHttp(id, path, label, labelEn)));
  const pages: P22BrowserCheckResult[] = [];
  for (const [id, path, label, labelEn] of PUBLIC_PATHS) {
    pages.push(await checkPage(`${id}-desktop`, path, `${label}（桌面）`, `${labelEn} (desktop)`, 1440, 900));
    pages.push(await checkPage(`${id}-mobile`, path, `${label}（移动）`, `${labelEn} (mobile)`, 390, 844));
  }
  return {
    generatedAt: new Date().toISOString(),
    passed: [...contract, ...pages].every((result) => result.status === "passed"),
    contract,
    pages,
  };
}

async function checkHttp(id: string, path: string, label: string, labelEn: string): Promise<P22BrowserCheckResult> {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(path, window.location.origin), {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    const latencyMs = elapsed(startedAt);
    return response.ok
      ? passed(id, label, labelEn, `HTTP ${response.status}`, `HTTP ${response.status}`, latencyMs)
      : failed(id, label, labelEn, `HTTP ${response.status}`, `HTTP ${response.status}`, latencyMs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(id, label, labelEn, `请求失败：${detail}`, `Request failed: ${detail}`, elapsed(startedAt));
  }
}

async function checkPage(id: string, path: string, label: string, labelEn: string, viewportWidth: number, viewportHeight: number): Promise<P22BrowserCheckResult> {
  const startedAt = performance.now();
  let frame: HTMLIFrameElement | null = null;
  try {
    const response = await fetch(new URL(path, window.location.origin), {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return failed(id, label, labelEn, `页面返回 HTTP ${response.status}`, `Page returned HTTP ${response.status}`, elapsed(startedAt));
    }

    frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${viewportWidth}px;height:${viewportHeight}px;border:0;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(frame);
    await waitForFrameLoad(frame, new URL(path, window.location.origin).toString());

    const clientErrors: string[] = [];
    frame.contentWindow?.addEventListener("error", (event) => clientErrors.push(event.message || "page error"));
    frame.contentWindow?.addEventListener("unhandledrejection", () => clientErrors.push("unhandled promise rejection"));
    await new Promise((resolve) => window.setTimeout(resolve, 900));

    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (!documentElement || !body) {
      return failed(id, label, labelEn, "页面文档未加载", "Page document did not load", elapsed(startedAt));
    }
    const failedImages = [...(frame.contentDocument?.images ?? [])].filter((image) => image.complete && image.currentSrc && image.naturalWidth === 0);
    const scrollWidth = Math.max(documentElement.scrollWidth, body.scrollWidth);
    const issues = [
      scrollWidth > viewportWidth ? `横向溢出 ${scrollWidth}px` : "",
      failedImages.length ? `${failedImages.length} 张图片加载失败` : "",
      clientErrors.length ? `${clientErrors.length} 个浏览器错误` : "",
    ].filter(Boolean);
    const detail = issues.length ? issues.join("；") : `加载正常，${elapsed(startedAt)} ms`;
    const detailEn = issues.length ? issues.join("; ") : `Loaded in ${elapsed(startedAt)} ms`;
    return issues.length ? failed(id, label, labelEn, detail, detailEn, elapsed(startedAt)) : passed(id, label, labelEn, detail, detailEn, elapsed(startedAt));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(id, label, labelEn, `页面检查失败：${detail}`, `Page check failed: ${detail}`, elapsed(startedAt));
  } finally {
    frame?.remove();
  }
}

function waitForFrameLoad(frame: HTMLIFrameElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("页面加载超时")), 30_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    frame.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("页面加载失败"));
    }, { once: true });
    frame.src = url;
  });
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function passed(id: string, label: string, labelEn: string, detail: string, detailEn: string, latencyMs: number): P22BrowserCheckResult {
  return { id, label, labelEn, status: "passed", detail, detailEn, latencyMs };
}

function failed(id: string, label: string, labelEn: string, detail: string, detailEn: string, latencyMs: number): P22BrowserCheckResult {
  return { id, label, labelEn, status: "failed", detail, detailEn, latencyMs };
}
