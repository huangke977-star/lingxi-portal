"use client";

import { SuggestionsPanel } from "@/components/suggestions-panel";
import { useLanguage } from "@/components/language-provider";

export default function SuggestionsPage() {
  const { locale, t } = useLanguage();
  return <section className="p8-page p8-directory-page"><header className="p8-page-heading"><div>{locale === "zh-CN" ? <span className="section-label">SUGGESTIONS</span> : null}<h1>{t("suggestion.title")}</h1></div></header><SuggestionsPanel pageSize={12} showLoadMore showSearch title={t("suggestion.all")} /></section>;
}
