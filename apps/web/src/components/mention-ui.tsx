/* eslint-disable @next/next/no-img-element */

import { RoleSymbol } from "@/components/role-symbol";
import { useLanguage } from "@/components/language-provider";
import { resolveApiUrl } from "@/lib/auth-api";
import type { SocialUserSearchResult } from "@/lib/social-api";
import { getAvatarFallbackText } from "@/lib/user-display";
import { useRef, type ChangeEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement, type RefObject, type SyntheticEvent, type TextareaHTMLAttributes, type UIEvent } from "react";

export function getActiveMention(value: string, cursor: number): { start: number; end: number; query: string } | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length - match[1].length - 1;
  return { start, end: cursor, query: match[1] };
}

export function getMentionCaretPosition(
  textarea: HTMLTextAreaElement,
  cursor: number,
  anchor: HTMLElement,
): { left: number; bottom: number } | null {
  if (!textarea.isConnected || !anchor.isConnected) return null;
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const caret = document.createElement("span");
  const properties = [
    "boxSizing", "fontFamily", "fontSize", "fontStretch", "fontStyle", "fontVariant", "fontWeight",
    "letterSpacing", "lineHeight", "padding", "textIndent", "textTransform", "wordSpacing", "wordWrap",
  ] as const;
  properties.forEach((property) => { mirror.style[property] = computed[property]; });
  mirror.style.position = "fixed";
  mirror.style.left = `${textarea.getBoundingClientRect().left}px`;
  mirror.style.top = `${textarea.getBoundingClientRect().top}px`;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.minHeight = `${textarea.clientHeight}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "anywhere";
  mirror.style.wordBreak = "break-word";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.textContent = textarea.value.slice(0, cursor) || "\u200b";
  caret.textContent = "\u200b";
  mirror.appendChild(caret);
  document.body.appendChild(mirror);
  const caretRect = caret.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  mirror.remove();
  return {
    left: Math.max(0, caretRect.left - textareaRect.left + textareaRect.left - anchorRect.left - textarea.scrollLeft),
    bottom: Math.max(0, anchorRect.bottom - caretRect.top + textarea.scrollTop + 6),
  };
}

export function MentionText({ text }: { text: string }) {
  const nodes: Array<string | ReactElement> = [];
  const pattern = /(^|\s)(@[A-Za-z0-9_]{2,32})(?=\s|$)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const tokenStart = (match.index ?? 0) + match[1].length;
    if (tokenStart > lastIndex) nodes.push(text.slice(lastIndex, tokenStart));
    nodes.push(<span className="mention-token" key={`${match[2]}-${tokenStart}`}>{match[2]}</span>);
    lastIndex = tokenStart + match[2].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

type MentionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  mentionsEnabled?: boolean;
  onChange: (value: string, cursor: number) => void;
  onCursorChange?: (cursor: number) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
};

/** Keeps the native textarea interaction while painting confirmed mentions above it. */
export function MentionTextarea({ mentionsEnabled = true, onChange, onCursorChange, onClick, onKeyUp, onPaste, onScroll, textareaRef, value, ...props }: MentionTextareaProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.currentTarget.value, event.currentTarget.selectionStart);
  }

  function handleCursor(event: MouseEvent<HTMLTextAreaElement> | KeyboardEvent<HTMLTextAreaElement> | SyntheticEvent<HTMLTextAreaElement>) {
    onCursorChange?.(event.currentTarget.selectionStart);
  }

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = event.currentTarget.scrollTop;
      overlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    onScroll?.(event);
  }

  return <div className={`mention-textarea-shell${mentionsEnabled ? " is-mentions-enabled" : ""}${value ? " has-value" : ""}`}>
    {mentionsEnabled && value ? <div aria-hidden="true" className="mention-textarea-overlay" ref={overlayRef}><MentionText text={value} /></div> : null}
    <textarea {...props} onChange={handleChange} onClick={(event) => { handleCursor(event); onClick?.(event); }} onFocus={handleCursor} onInput={handleCursor} onKeyDown={(event) => { handleCursor(event); props.onKeyDown?.(event); }} onKeyUp={(event) => { handleCursor(event); onKeyUp?.(event); }} onPaste={onPaste} onScroll={handleScroll} onSelect={handleCursor} ref={textareaRef} value={value} />
  </div>;
}

export function MentionSuggestions({
  isLoading,
  items,
  onSelect,
  style,
}: {
  isLoading: boolean;
  items: SocialUserSearchResult[];
  onSelect: (user: SocialUserSearchResult) => void;
  style?: CSSProperties;
}) {
  const { phrase } = useLanguage();
  if (!isLoading && !items.length) return null;
  return <div className="mention-suggestions" role="listbox" style={style}>
    {isLoading ? <span className="mention-suggestions-loading">{phrase("正在搜索用户...", "Searching users...")}</span> : items.map((user) => {
      const avatar = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
      return <button
        key={user.id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(user)}
        aria-selected={false}
        role="option"
        type="button"
      >
        <span className="mention-suggestion-avatar">{avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(user)}</span>
        <span><strong>{user.nickname}</strong><small>@{user.username}</small></span>
        <RoleSymbol code={user.role.code} />
      </button>;
    })}
  </div>;
}
