export type InstallOutcome = "accepted" | "dismissed";

export interface HlovetInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
}

export const PWA_INSTALL_PROMPT_CHANGE_EVENT = "hlovet:pwa-install-prompt-change";

declare global {
  interface Window {
    __hlovetInstallPrompt?: HlovetInstallPromptEvent;
  }
}

function canUseWindow() {
  return typeof window !== "undefined";
}

export function isStandaloneDisplay() {
  if (!canUseWindow()) return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIosDevice() {
  if (!canUseWindow()) return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  return /iphone|ipad|ipod/.test(ua)
    || (platform === "macintel" && window.navigator.maxTouchPoints > 1);
}

export function isAndroidDevice() {
  if (!canUseWindow()) return false;
  return /android/.test(window.navigator.userAgent.toLowerCase());
}

export function isMobileLikeDevice() {
  if (!canUseWindow()) return false;
  return isIosDevice()
    || isAndroidDevice()
    || window.matchMedia("(pointer: coarse)").matches
    || window.matchMedia("(max-width: 760px)").matches;
}

export function getFallbackInstallMessage(isIos: boolean, isAndroid: boolean) {
  if (isIos) return "iPhone/iPad 请点 Safari 分享按钮，再选择添加到主屏幕。";
  if (isAndroid) return "请用 Chrome 打开本站；若未弹出安装窗口，打开安装诊断查看原因。";
  return "请在浏览器地址栏或菜单中选择安装应用或添加到主屏幕。";
}

export function readInstallPrompt() {
  if (!canUseWindow()) return null;
  return window.__hlovetInstallPrompt ?? null;
}

export function storeInstallPrompt(event: Event) {
  if (!canUseWindow()) return;
  event.preventDefault();
  window.__hlovetInstallPrompt = event as HlovetInstallPromptEvent;
  window.dispatchEvent(new CustomEvent(PWA_INSTALL_PROMPT_CHANGE_EVENT));
}

export function clearInstallPrompt() {
  if (!canUseWindow()) return;
  window.__hlovetInstallPrompt = undefined;
  window.dispatchEvent(new CustomEvent(PWA_INSTALL_PROMPT_CHANGE_EVENT));
}

export async function promptPwaInstall() {
  const installPrompt = readInstallPrompt();
  if (!installPrompt) return null;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  clearInstallPrompt();
  return choice;
}
