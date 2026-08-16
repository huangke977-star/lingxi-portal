import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";

const RESOURCE_OPEN_PATTERN = /^:::resource\{points=(\d+)\}\s*$/;
const RESOURCE_CLOSE_PATTERN = /^:::\s*$/;

export interface ParsedArticleResourceBlock {
  key: string;
  pointCost: number;
  content: string;
}

export interface ParsedArticleMarkdownSegment {
  type: "markdown";
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
  | ParsedArticleResourceSegment;

export interface ParsedArticleContent {
  segments: ParsedArticleContentSegment[];
  blocks: ParsedArticleResourceBlock[];
}

/**
 * Parses the deliberately small resource-block syntax before Markdown rendering.
 * Keeping this server-side prevents locked text from being sent to readers.
 */
export function parseArticleContent(source: string): ParsedArticleContent {
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
        if (!Number.isInteger(resourceCost) || resourceCost < 1 || resourceCost > 10000) {
          throw new BadRequestException("资源块积分必须是 1 到 10000 的整数。");
        }
        resourceLines = [];
        return;
      }
    }
    if (resourceLines !== null) {
      if (RESOURCE_CLOSE_PATTERN.test(trimmed)) {
        const content = resourceLines.join("\n").trim();
        if (!content) throw new BadRequestException("资源块内容不能为空。");
        const digest = createHash("sha256")
          .update(`${resourceCost}\0${content}`)
          .digest("hex")
          .slice(0, 20);
        const key = `resource-${blocks.length + 1}-${digest}`;
        const block = { key, pointCost: resourceCost, content };
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
