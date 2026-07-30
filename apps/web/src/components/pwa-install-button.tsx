"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";

type InstallOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIosDevice() {
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  return /iphone|ipad|ipod/.test(ua)
    || (platform === "macintel" && window.navigator.maxTouchPoints > 1);
}

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Browser install support is event-driven, so the header only appears when useful.
    const frame = window.requestAnimationFrame(() => {
      setIsStandalone(isStandaloneDisplay());
      setIsIos(isIosDevice());
    });

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallPrompt(null);
      setIsStandalone(true);
      setNotice("HLOVET 已添加到设备。");
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") {
        setIsStandalone(true);
        setNotice("HLOVET 已开始安装。");
      } else {
        setNotice("安装已取消。");
      }
      return;
    }

    setNotice(isIos
      ? "iPhone/iPad 请点 Safari 分享按钮，再选择添加到主屏幕。"
      : "请在浏览器菜单中选择安装应用或添加到主屏幕。");
  }

  if (isStandalone || (!installPrompt && !isIos)) {
    return <AppToast duration={3600} message={notice} onDismiss={() => setNotice("")} tone="info" />;
  }

  return (
    <>
      <button
        aria-label="安装 HLOVET"
        className="header-action-button pwa-install-button"
        onClick={() => void handleInstall()}
        title="安装 HLOVET"
        type="button"
      >
        <Download aria-hidden="true" size={18} />
      </button>
      <AppToast duration={5200} message={notice} onDismiss={() => setNotice("")} tone="info" />
    </>
  );
}
