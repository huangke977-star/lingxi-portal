import type { Metadata } from "next";
import { headers } from "next/headers";
import { PwaDiagnostics } from "@/components/pwa-diagnostics";
import { isLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await headers()).get("x-lingxi-locale");
  const isEnglish = isLocale(locale) && locale === "en-US";
  return {
    title: isEnglish ? "Install diagnostics - HLOVET" : "安装诊断 - HLOVET",
    description: isEnglish
      ? "Check whether HLOVET can be installed as a PWA in this browser."
      : "检查 HLOVET 在当前浏览器中的 PWA 安装条件。",
  };
}

export default function InstallPage() {
  return <PwaDiagnostics />;
}
