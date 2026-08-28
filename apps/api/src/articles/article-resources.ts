import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import sanitizeHtml from "sanitize-html";

const RESOURCE_OPEN_PATTERN = /^:::resource\{points=(\d+)\}\s*$/;
const RESOURCE_CLOSE_PATTERN = /^:::\s*$/;
const RESOURCE_HTML_PATTERN = /<resource-block\b([^>]*)>([\s\S]*?)<\/resource-block>/gi;

export type ArticleContentFormat = "markdown" | "html";

const HTML_ALLOWED_TAGS = [
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "u",
  "blockquote", "ul", "ol", "li", "pre", "code", "a", "img", "hr", "table",
  "thead", "tbody", "tr", "th", "td", "resource-block",
];

const HTML_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel"],
  img: ["src", "alt", "title"],
  "resource-block": ["data-points"],
};

export function sanitizeArticleHtml(source: string): string {
  return sanitizeHtml(source, {
    allowedTags: HTML_ALLOWED_TAGS,
    allowedAttributes: HTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  }).trim();
}

export function normalizeArticleContent(source: string, format: ArticleContentFormat): string {
  return format === "html" ? sanitizeArticleHtml(source) : source.trim();
}

export function articleContentToPlainText(source: string, format: ArticleContentFormat): string {
  if (format === "markdown") return source;
  return sanitizeHtml(source, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

export interface ParsedArticleResourceBlock {
  key: string;
  pointCost: number;
  content: string;
}

export interface ParsedArticleMarkdownSegment {
  type: "markdown";
  content: string;
}

export interface ParsedArticleHtmlSegment {
  type: "html";
  content: string;
}

export interface ParsedArticleResourceSegment {
  type: "resource";
  key: string;
  pointCost: number;
  content: string;
}

export type ParsedArticleContentSegment =
  | ParsedArticleMarkdownSegment
  | ParsedArticleHtmlSegment
  | ParsedArticleResourceSegment;

export interface ParsedArticleContent {
  segments: ParsedArticleContentSegment[];
  blocks: ParsedArticleResourceBlock[];
}

/**
 * Parses resource blocks before rendering so locked bodies never leave the API.
 * Markdown remains supported for legacy articles; new articles use HTML nodes.
 */
export function parseArticleContent(source: string, format: ArticleContentFormat = "markdown"): ParsedArticleContent {
  return format === "html" ? parseArticleHtmlContent(source) : parseArticleMarkdownContent(source);
}

function parseArticleMarkdownContent(source: string): ParsedArticleContent {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const segments: ParsedArticleContentSegment[] = [];
  const blocks: ParsedArticleResourceBlock[] = [];
  let markdownLines: string[] = [];
  let resourceLines: string[] | null = null;
  let resourceCost = 0;
  let fenced = false;

  const flushMarkdown = () => {
    const content = markdownLines.join("\n").trim();
    if (content.trim()) segments.push({ type: "markdown", content });
    markdownLines = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const fence = /^(```|~~~)/.test(trimmed);
    if (resourceLines === null && !fenced) {
      const opening = RESOURCE_OPEN_PATTERN.exec(trimmed);
      if (opening) {
        flushMarkdown();
        resourceCost = Number(opening[1]);
        validatePointCost(resourceCost);
        resourceLines = [];
        return;
      }
    }
    if (resourceLines !== null) {
      if (RESOURCE_CLOSE_PATTERN.test(trimmed)) {
        const content = resourceLines.join("\n").trim();
        if (!content) throw new BadRequestException("资源块内容不能为空。");
        const block = createResourceBlock(resourceCost, content, blocks.length);
        blocks.push(block);
        segments.push({ type: "resource", ...block });
        resourceLines = null;
        resourceCost = 0;
        return;
      }
      resourceLines.push(line);
      return;
    }
    markdownLines.push(line);
    if (fence) fenced = !fenced;
  });

  if (resourceLines !== null) throw new BadRequestException("资源块缺少结束标记 :::。");
  flushMarkdown();
  return { segments, blocks };
}

function parseArticleHtmlContent(source: string): ParsedArticleContent {
  const sanitized = sanitizeArticleHtml(source);
  const segments: ParsedArticleContentSegment[] = [];
  const blocks: ParsedArticleResourceBlock[] = [];
  let cursor = 0;

  const appendHtml = (content: string) => {
    const value = content.trim();
    if (value) segments.push({ type: "html", content: value });
  };

  for (const match of sanitized.matchAll(RESOURCE_HTML_PATTERN)) {
    const index = match.index ?? 0;
    appendHtml(sanitized.slice(cursor, index));
    const attributes = match[1] ?? "";
    const pointCost = Number(/data-points=["'](\d+)["']/i.exec(attributes)?.[1]);
    const content = (match[2] ?? "").trim();
    validatePointCost(pointCost);
    if (!content || !articleContentToPlainText(content, "html")) {
      throw new BadRequestException("资源块内容不能为空。");
    }
    const block = createResourceBlock(pointCost, content, blocks.length);
    blocks.push(block);
    segments.push({ type: "resource", ...block });
    cursor = index + match[0].length;
  }
  appendHtml(sanitized.slice(cursor));
  return { segments, blocks };
}

function createResourceBlock(pointCost: number, content: string, index: number): ParsedArticleResourceBlock {
  const digest = createHash("sha256")
    .update(`${pointCost}\0${content}`)
    .digest("hex")
    .slice(0, 20);
  return { key: `resource-${index + 1}-${digest}`, pointCost, content };
}

function validatePointCost(pointCost: number): void {
  if (!Number.isInteger(pointCost) || pointCost < 1 || pointCost > 10000) {
    throw new BadRequestException("资源块积分必须是 1 到 10000 的整数。");
  }
}
