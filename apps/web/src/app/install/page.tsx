import type { Metadata } from "next";
import { PwaDiagnostics } from "@/components/pwa-diagnostics";

export const metadata: Metadata = {
  title: "安装诊断 - HLOVET",
  description: "检查 HLOVET 在当前浏览器中的 PWA 安装条件。",
};

export default function InstallPage() {
  return <PwaDiagnostics />;
}
