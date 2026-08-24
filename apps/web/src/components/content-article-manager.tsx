"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, GripVertical, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatArticleDate } from "@/components/article-ui";
import { useLanguage } from "@/components/language-provider";

export interface ManageableArticle {
  id: number;
  title: string;
  category: string;
  publishedAt: string | null;
  author: { nickname: string };
}

export function ContentArticleManager({
  articles,
  selectedArticles,
  noun,
  onToggle,
  onReorder,
}: {
  articles: ManageableArticle[];
  selectedArticles: ManageableArticle[];
  noun: string;
  onToggle: (articleId: number, selected: boolean) => Promise<void>;
  onReorder: (ids: number[]) => Promise<void>;
}) {
  const { phrase } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedIds = useMemo(
    () => new Set(selectedArticles.map((article) => article.id)),
    [selectedArticles],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return articles;
    return articles.filter((article) => {
      const searchable = `${article.title} ${article.author.nickname} ${article.category}`;
      return searchable
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [articles, query]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  async function toggle(articleId: number) {
    if (busyId) return;
    setBusyId(articleId);
    try {
      await onToggle(articleId, selectedIds.has(articleId));
    } finally {
      setBusyId(0);
    }
  }

  async function dragEnd(event: DragEndEvent) {
    const activeId = Number(event.active.id);
    const overId = Number(event.over?.id);
    if (!overId || activeId === overId) return;
    const oldIndex = selectedArticles.findIndex(
      (article) => article.id === activeId,
    );
    const newIndex = selectedArticles.findIndex(
      (article) => article.id === overId,
    );
    if (oldIndex < 0 || newIndex < 0) return;
    await onReorder(
      arrayMove(selectedArticles, oldIndex, newIndex).map(
        (article) => article.id,
      ),
    );
  }

  return (
    <div className="content-article-manager">
      <div className="glass-multi-select" ref={rootRef}>
        <button
          aria-expanded={open}
          className="glass-multi-select-trigger"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{phrase("选择文章", "Select articles")}</span>
          <small>{phrase(`已选 ${selectedArticles.length} 篇`, `${selectedArticles.length} selected`)}</small>
          <ChevronDown aria-hidden="true" size={16} />
        </button>
        {open ? (
          <div className="glass-multi-select-menu">
            <label>
              <Search aria-hidden="true" size={15} />
              <input
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder={phrase("搜索标题、作者或分类", "Search title, author, or category")}
                value={query}
              />
            </label>
            <div className="glass-multi-select-options">
              {filtered.map((article) => {
                const active = selectedIds.has(article.id);
                return (
                  <button
                    className={active ? "active" : undefined}
                    disabled={Boolean(busyId)}
                    key={article.id}
                    onClick={() => void toggle(article.id)}
                    type="button"
                  >
                    <span>
                      <strong>{article.title}</strong>
                      <small>
                        {article.author.nickname} · {article.category || phrase("随笔", "Notes")}
                      </small>
                    </span>
                    {active ? <Check aria-hidden="true" size={16} /> : null}
                  </button>
                );
              })}
              {!filtered.length ? <p>{phrase("没有匹配的已发布文章。", "No matching published articles.")}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={(event) => void dragEnd(event)}
        sensors={sensors}
      >
        <SortableContext
          items={selectedArticles.map((article) => article.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="collection-article-list">
            {selectedArticles.map((article) => (
              <SortableArticle
                key={article.id}
                article={article}
                noun={noun}
                onRemove={() => void toggle(article.id)}
              />
            ))}
            {!selectedArticles.length ? (
              <div className="article-empty-inline">{phrase(`这个${noun}还没有文章。`, `This ${noun} has no articles yet.`)}</div>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableArticle({
  article,
  noun,
  onRemove,
}: {
  article: ManageableArticle;
  noun: string;
  onRemove: () => void;
}) {
  const { locale, phrase } = useLanguage();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: article.id });
  return (
    <article
      className={isDragging ? "dragging" : undefined}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        aria-label={phrase(`拖动调整${article.title}的顺序`, `Drag to reorder ${article.title}`)}
        className="article-drag-handle"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" size={16} />
      </button>
      <span>
        <strong>{article.title}</strong>
        <small>
          {article.author.nickname} · {article.category || phrase("随笔", "Notes")} ·{" "}
          {formatArticleDate(article.publishedAt, locale)}
        </small>
      </span>
      <button
        aria-label={phrase(`移出${noun}`, `Remove from ${noun}`)}
        onClick={onRemove}
        title={phrase(`移出${noun}`, `Remove from ${noun}`)}
        type="button"
      >
        <X aria-hidden="true" size={15} />
      </button>
    </article>
  );
}
