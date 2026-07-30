"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import {
  PWA_INSTALL_PROMPT_CHANGE_EVENT,
  clearInstallPrompt,
  getFallbackInstallMessage,
  isAndroidDevice,
  isIosDevice,
  isMobileLikeDevice,
  isStandaloneDisplay,
  promptPwaInstall,
  readInstallPrompt,
  storeInstallPrompt,
} from "@/lib/pwa-install";

export function PwaInstallButton() {
  const [hasInstallPrompt, setHasInstallPrompt] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobileLike, setIsMobileLike] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Browser install support is event-driven; mobile still gets a visible guide
    // because some Android browsers hide the install menu until Chrome trusts the app.
    const frame = window.requestAnimationFrame(() => {
      setIsStandalone(isStandaloneDisplay());
      setIsIos(isIosDevice());
      setIsAndroid(isAndroidDevice());
      setIsMobileLike(isMobileLikeDevice());
      setHasInstallPrompt(Boolean(readInstallPrompt()));
    });

    function handleBeforeInstallPrompt(event: Event) {
      storeInstallPrompt(event);
    }

    function handleInstallPromptChange() {
      setHasInstallPrompt(Boolean(readInstallPrompt()));
    }

    function handleAppInstalled() {
      clearInstallPrompt();
      setIsStandalone(true);
      setNotice("HLOVET 已添加到设备。");
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener(PWA_INSTALL_PROMPT_CHANGE_EVENT, handleInstallPromptChange);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener(PWA_INSTALL_PROMPT_CHANGE_EVENT, handleInstallPromptChange);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (hasInstallPrompt) {
      const choice = await promptPwaInstall();
      if (!choice) {
        setNotice("安装窗口暂时不可用，正在打开安装诊断。");
        if (window.location.pathname !== "/install") window.setTimeout(() => { window.location.href = "/install"; }, 420);
        return;
      }
      if (choice.outcome === "accepted") {
        setIsStandalone(true);
        setNotice("HLOVET 已开始安装。");
      } else {
        setNotice("安装已取消。");
      }
      return;
    }

    setNotice(`${getFallbackInstallMessage(isIos, isAndroid)} 正在打开安装诊断。`);
    if (window.location.pathname !== "/install") {
      window.setTimeout(() => {
        window.location.href = "/install";
      }, 420);
    }
  }

  if (isStandalone || (!hasInstallPrompt && !isMobileLike)) {
    return <AppToast duration={3600} message={notice} onDismiss={() => setNotice("")} tone="info" />;
  }

  return (
    <>
      <button
        aria-label="安装 HLOVET"
        className="header-action-button pwa-install-button"
        onClick={() => void handleInstall()}
        title="安装到主屏幕"
        type="button"
      >
        <Download aria-hidden="true" size={18} />
      </button>
      <AppToast duration={5200} message={notice} onDismiss={() => setNotice("")} tone="info" />
    </>
  );
}
