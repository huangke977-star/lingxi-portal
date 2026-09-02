/* eslint-disable @next/next/no-img-element */

import { RoleSymbol } from "@/components/role-symbol";
import { useLanguage } from "@/components/language-provider";
import { resolveApiUrl } from "@/lib/auth-api";
import type { SocialUserSearchResult } from "@/lib/social-api";
import { getAvatarFallbackText } from "@/lib/user-display";

export function getActiveMention(value: string, cursor: number): { start: number; end: number; query: string } | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length - match[1].length - 1;
  return { start, end: cursor, query: match[1] };
}

export function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z0-9_]{2,32})/g);
  return <>{parts.map((part, index) => /^@[A-Za-z0-9_]{2,32}$/.test(part)
    ? <span className="mention-token" key={`${part}-${index}`}>{part}</span>
    : part)}</>;
}

export function MentionSuggestions({
  isLoading,
  items,
  onSelect,
}: {
  isLoading: boolean;
  items: SocialUserSearchResult[];
  onSelect: (user: SocialUserSearchResult) => void;
}) {
  const { phrase } = useLanguage();
  if (!isLoading && !items.length) return null;
  return <div className="mention-suggestions" role="listbox">
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
