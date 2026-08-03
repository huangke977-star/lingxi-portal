"use client";

/* eslint-disable @next/next/no-img-element */

import { ExternalLink, FileText, Search, UserRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { globalSearch, GlobalSearchResult } from "@/lib/search-api";
import { getAvatarFallbackText } from "@/lib/user-display";

export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
    setIsOpen(false);
    router.push(`/search?q=${encodeURIComponent(keyword)}`);
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
    <button aria-label="全站搜索" className="header-action-button global-search-trigger" onClick={() => setIsOpen(true)} title="搜索" type="button">
      <Search aria-hidden="true" size={19} />
    </button>
    {isOpen && typeof document !== "undefined" ? createPortal(
      <div className="global-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} role="presentation">
        <section aria-label="全站搜索" aria-modal="true" className="global-search-dialog" role="dialog">
          <form className="global-search-input" onSubmit={submit}>
            <Search aria-hidden="true" size={20} />
            <input aria-label="搜索文章、用户、导航和工具" onChange={(event) => updateQuery(event.target.value)} placeholder="搜索文章、用户、导航和工具" ref={inputRef} value={query} />
            {query ? <button aria-label="清空搜索" onClick={() => updateQuery("")} type="button"><X aria-hidden="true" size={17} /></button> : null}
          </form>
          <div className="global-search-results">
            {!query.trim() ? <div className="global-search-hint"><Search aria-hidden="true" size={24} /><span>输入关键词开始搜索。</span></div> : null}
            {isLoading ? <div className="global-search-hint"><span>正在搜索。</span></div> : null}
            {!isLoading && result ? <>
              <SearchSection count={result.articles.total} icon={FileText} title="文章">
                {result.articles.items.map((article) => <Link href={`/articles/${article.slug}`} key={article.id} onClick={close}><span className="global-result-icon"><FileText aria-hidden="true" size={17} /></span><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || "随笔"}</small></span></Link>)}
              </SearchSection>
              <SearchSection count={result.users.total} icon={UserRound} title="用户">
                {result.users.items.map((user) => <Link href={`/users/${encodeURIComponent(user.username)}`} key={user.id} onClick={close}><span className="global-result-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><span><strong>{user.nickname}</strong><small>@{user.username} · {user.role.name}</small></span></Link>)}
              </SearchSection>
              <SearchSection count={result.entries.total} icon={Wrench} title="导航与工具">
                {result.entries.items.map((entry) => entry.url ? <a href={entry.url} key={entry.id} onClick={close} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="global-result-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Wrench aria-hidden="true" size={17} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small></span><ExternalLink aria-hidden="true" size={14} /></a> : null)}
              </SearchSection>
              {!result.articles.total && !result.users.total && !result.entries.total ? <div className="global-search-hint"><span>没有找到匹配内容。</span></div> : null}
            </> : null}
          </div>
          {query.trim() ? <button className="global-search-all" onClick={() => { close(); router.push(`/search?q=${encodeURIComponent(query.trim())}`); }} type="button">查看全部搜索结果</button> : null}
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
