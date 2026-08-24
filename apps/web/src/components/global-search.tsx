"use client";

/* eslint-disable @next/next/no-img-element */

import { Clock3, Compass, ExternalLink, FileText, Flame, Search, UserRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import { clearSearchHistory, globalSearch, GlobalSearchResult, HotSearchItem, listHotSearches, listSearchHistory, recordSearch, SearchHistoryItem } from "@/lib/search-api";
import { getAvatarFallbackText } from "@/lib/user-display";

export function GlobalSearch() {
  const router = useRouter();
  const { locale, phrase, t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [hot, setHot] = useState<HotSearchItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const token = readAccessToken();
    Promise.all([
      listHotSearches(8).catch(() => ({ items: [] })),
      token ? listSearchHistory(token).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    ]).then(([hotResult, historyResult]) => {
      setHot(hotResult.items);
      setHistory(historyResult.items);
    });
  }, [isOpen]);

  useEffect(() => {
    const keyword = query.trim();
    if (!isOpen || !keyword) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      globalSearch(keyword, { accessToken: readAccessToken(), pageSize: 4 })
        .then((next) => { if (active) setResult(next); })
        .catch(() => { if (active) setResult(null); })
        .finally(() => { if (active) setIsLoading(false); });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = query.trim();
    if (!keyword) return;
    openSearch(keyword);
  }

  function openSearch(keyword: string) {
    const token = readAccessToken();
    if (token) void recordSearch(token, keyword).catch(() => undefined);
    close();
    router.push(`${localizedPath("/search", locale)}?q=${encodeURIComponent(keyword)}`);
  }

  async function clearHistory() {
    const token = readAccessToken();
    if (!token) return;
    await clearSearchHistory(token).catch(() => undefined);
    setHistory([]);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setResult(null);
    setIsLoading(Boolean(value.trim()));
  }

  function close() {
    setIsOpen(false);
    setQuery("");
    setResult(null);
    setIsLoading(false);
  }

  return <>
    <button aria-label={t("search.open")} className="header-action-button global-search-trigger" onClick={() => setIsOpen(true)} title={t("common.search")} type="button">
      <Search aria-hidden="true" size={19} />
    </button>
    {isOpen && typeof document !== "undefined" ? createPortal(
      <div className="global-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} role="presentation">
        <section aria-label={t("search.open")} aria-modal="true" className="global-search-dialog" role="dialog">
          <form className="global-search-input" onSubmit={submit}>
            <Search aria-hidden="true" size={20} />
            <input aria-label={t("search.placeholder")} onChange={(event) => updateQuery(event.target.value)} placeholder={t("search.placeholder")} ref={inputRef} value={query} />
            {query ? <button aria-label={t("search.clear")} onClick={() => updateQuery("")} type="button"><X aria-hidden="true" size={17} /></button> : null}
          </form>
          <div className="global-search-results">
            {!query.trim() ? <div className="global-search-suggestions">{history.length ? <section><header><span><Clock3 aria-hidden="true" size={15} /><strong>{t("search.recent")}</strong></span><button onClick={() => void clearHistory()} type="button">{t("common.clear")}</button></header><div>{history.slice(0, 8).map((item) => <button key={item.id} onClick={() => openSearch(item.keyword)} type="button"><span>{item.keyword}</span><small>{item.searchCount > 1 ? `${item.searchCount}` : ""}</small></button>)}</div></section> : null}{hot.length ? <section><header><span><Flame aria-hidden="true" size={15} /><strong>{t("search.hot")}</strong></span></header><div>{hot.map((item, index) => <button key={item.keyword} onClick={() => openSearch(item.keyword)} type="button"><b>{index + 1}</b><span>{item.keyword}</span><small>{item.searchCount}</small></button>)}</div></section> : null}{!history.length && !hot.length ? <div className="global-search-hint"><Search aria-hidden="true" size={24} /><span>{t("search.start")}</span></div> : null}</div> : null}
            {isLoading ? <div className="global-search-hint"><span>{t("search.searching")}</span></div> : null}
            {!isLoading && result ? <>
              <SearchSection count={result.articles.total} icon={FileText} title={t("search.articles")}>
                {result.articles.items.map((article) => <Link href={localizedPath(`/articles/${article.slug}`, locale)} key={article.id} onClick={close}><span className="global-result-icon"><FileText aria-hidden="true" size={17} /></span><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || phrase("随笔", "Notes")}</small></span></Link>)}
              </SearchSection>
              <SearchSection count={result.users.total} icon={UserRound} title={t("search.users")}>
                {result.users.items.map((user) => <Link href={localizedPath(`/users/${encodeURIComponent(user.username)}`, locale)} key={user.id} onClick={close}><span className="global-result-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><span><strong>{user.nickname}</strong><small>@{user.username} · {user.role.name}</small></span></Link>)}
              </SearchSection>
              <SearchSection count={result.navigation.total} icon={Compass} title={t("search.navigation")}>
                {result.navigation.items.map((entry) => entry.url ? <a href={entry.url} key={entry.id} onClick={close} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="global-result-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Compass aria-hidden="true" size={17} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small></span><ExternalLink aria-hidden="true" size={14} /></a> : null)}
              </SearchSection>
              <SearchSection count={result.tools.total} icon={Wrench} title={t("search.tools")}>
                {result.tools.items.map((entry) => entry.url ? <a href={entry.url} key={entry.id} onClick={close} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="global-result-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Wrench aria-hidden="true" size={17} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small></span><ExternalLink aria-hidden="true" size={14} /></a> : null)}
              </SearchSection>
              {!result.articles.total && !result.users.total && !result.navigation.total && !result.tools.total ? <div className="global-search-hint"><span>{t("search.noMatches")}</span></div> : null}
            </> : null}
          </div>
          {query.trim() ? <button className="global-search-all" onClick={() => openSearch(query.trim())} type="button">{t("search.viewAll")}</button> : null}
        </section>
      </div>,
      document.body,
    ) : null}
  </>;
}

function SearchSection({ count, icon: Icon, title, children }: { count: number; icon: typeof Search; title: string; children: React.ReactNode }) {
  if (!count) return null;
  return <section className="global-search-section"><header><Icon aria-hidden="true" size={15} /><strong>{title}</strong><span>{count}</span></header><div>{children}</div></section>;
}
