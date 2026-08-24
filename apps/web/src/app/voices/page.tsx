"use client";

import { AnonymousTopicsPanel } from "@/components/anonymous-topics-panel";
import { useLanguage } from "@/components/language-provider";

export default function VoicesPage() {
  const { locale, t } = useLanguage();
  return <section className="p8-page p8-directory-page"><header className="p8-page-heading"><div>{locale === "zh-CN" ? <span className="section-label">VOICES</span> : null}<h1>{t("voice.title")}</h1></div></header><AnonymousTopicsPanel pageSize={12} showLoadMore showSearch showSort title={t("voice.all")} /></section>;
}
