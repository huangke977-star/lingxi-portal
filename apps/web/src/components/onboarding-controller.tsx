"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Compass, LoaderCircle, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";
import { resolveApiUrl } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, readAccessToken } from "@/lib/auth-storage";
import { completeOnboarding, getOnboarding, type OnboardingState } from "@/lib/discovery-api";

export function OnboardingController() {
  const { phrase } = useLanguage();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const token = readAccessToken();
      if (!token) {
        if (active) setState(null);
        return;
      }
      try {
        const next = await getOnboarding(token);
        if (!active) return;
        setState(next);
        setSelectedIds(next.topics.filter((topic) => topic.subscribed).map((topic) => topic.id).slice(0, 6));
      } catch {
        if (active) setState(null);
      }
    }
    void load();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, load);
    };
  }, []);

  async function complete(topicIds: number[]) {
    const token = readAccessToken();
    if (!token || isSaving) return;
    setIsSaving(true);
    try {
      await completeOnboarding(token, topicIds);
      setState((current) => current ? { ...current, completed: true } : current);
    } finally {
      setIsSaving(false);
    }
  }

  function toggleTopic(id: number) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((topicId) => topicId !== id)
      : current.length >= 6 ? current : [...current, id]);
  }

  if (!state || state.completed || typeof document === "undefined") return null;
  return createPortal(
    <div aria-modal="true" className="onboarding-backdrop" role="dialog">
      <section aria-label={phrase("选择兴趣专题", "Choose your interests")} className="onboarding-dialog">
        <header>
          <span><Compass aria-hidden="true" size={18} /><strong>{phrase("选择感兴趣的专题", "Choose topics you like")}</strong></span>
          <small>{phrase("最多选择 6 个，后续可在订阅页随时调整。", "Choose up to 6. You can change subscriptions later.")}</small>
        </header>
        <main>
          {state.topics.map((topic) => {
            const selected = selectedIds.includes(topic.id);
            return <button aria-pressed={selected} className={selected ? "active" : ""} key={topic.id} onClick={() => toggleTopic(topic.id)} type="button">
              <span className="onboarding-topic-cover">{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <Compass aria-hidden="true" size={18} />}</span>
              <span><strong>{topic.title}</strong><small>{topic.description || phrase(`${topic.articleCount} 篇文章`, `${topic.articleCount} articles`)}</small></span>
              {selected ? <Check aria-hidden="true" size={16} /> : null}
            </button>;
          })}
          {!state.topics.length ? <p>{phrase("暂时没有可选专题，稍后可在发现页浏览。", "There are no topics to choose yet. You can browse them later in Discover.")}</p> : null}
        </main>
        <footer>
          <button disabled={isSaving} onClick={() => void complete([])} type="button"><SkipForward aria-hidden="true" size={16} />{phrase("暂时跳过", "Skip for now")}</button>
          <button className="primary" disabled={isSaving} onClick={() => void complete(selectedIds)} type="button">{isSaving ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Check aria-hidden="true" size={16} />}{phrase("完成", "Continue")}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
