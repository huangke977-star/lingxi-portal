import { pinyin } from "pinyin-pro";

export interface SearchFields {
  searchText: string;
  searchPinyin: string;
}

const EMPTY_SEARCH_INDEX = "__lingxi_empty_index__";

export function normalizeSearchKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildSearchFields(parts: Array<string | null | undefined>): SearchFields {
  const searchText = normalizeSearchKeyword(parts.filter(Boolean).join(" "));
  const full = pinyin(searchText, { toneType: "none", type: "array" })
    .map((part) => normalizeSearchKeyword(part))
    .filter(Boolean);
  const initials = pinyin(searchText, { pattern: "first", toneType: "none", type: "array" })
    .map((part) => normalizeSearchKeyword(part))
    .filter(Boolean);
  const searchPinyin = Array.from(new Set([
      full.join(" "),
      full.join(""),
      initials.join(""),
    ].filter(Boolean))).join(" ");
  return {
    searchText: (searchText || EMPTY_SEARCH_INDEX).slice(0, 4096),
    searchPinyin: (searchPinyin || EMPTY_SEARCH_INDEX).slice(0, 4096),
  };
}

export function searchNeedles(value: string): string[] {
  const normalized = normalizeSearchKeyword(value);
  if (!normalized) return [];
  const generated = buildSearchFields([normalized]);
  return Array.from(new Set([
    normalized,
    ...generated.searchPinyin.split(" "),
  ].filter(Boolean)));
}
