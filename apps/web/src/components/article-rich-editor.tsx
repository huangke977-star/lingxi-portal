"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Coins, Code2, ImagePlus, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Undo2, Unlink, X } from "lucide-react";
import { marked } from "marked";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";

export interface RichEditorImage {
  src: string;
  alt: string;
}

interface ArticleRichEditorProps {
  value: string;
  format: "markdown" | "html";
  onChange: (value: string, format: "html") => void;
  onImageFiles?: (files: File[]) => Promise<RichEditorImage[]>;
  onError?: (message: string) => void;
}

const ResourceBlock = Node.create({
  name: "resourceBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return { points: { default: 10 } };
  },
  parseHTML() {
    return [{ tag: "resource-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["resource-block", mergeAttributes({ "data-points": String(HTMLAttributes.points ?? 10) }, HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResourceBlockView);
  },
});

function ResourceBlockView({ node }: NodeViewProps) {
  const { phrase } = useLanguage();
  return (
    <NodeViewWrapper className="article-resource-editor-block">
      <div className="article-resource-editor-label" contentEditable={false}>
        <Coins aria-hidden="true" size={15} />
        <span>{phrase("积分资源区块", "Point resource block")}</span>
        <strong>{phrase(`${node.attrs.points} 积分`, `${node.attrs.points} points`)}</strong>
      </div>
      <NodeViewContent className="article-resource-editor-content" />
    </NodeViewWrapper>
  );
}

export function ArticleRichEditor({ value, format, onChange, onImageFiles, onError }: ArticleRichEditorProps) {
  const { phrase } = useLanguage();
  const [isResourceDialogOpen, setIsResourceDialogOpen] = useState(false);
  const [resourcePoints, setResourcePoints] = useState("10");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const selectionRef = useRef<{ from: number; to: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const imageHandlerRef = useRef(onImageFiles);

  useEffect(() => {
    imageHandlerRef.current = onImageFiles;
  }, [onImageFiles]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: phrase("开始写作，支持 Markdown 快捷输入…", "Start writing with Markdown shortcuts…") }),
      ResourceBlock,
    ],
    content: format === "markdown" ? markdownToHtml(value) : value,
    onUpdate: ({ editor: updatedEditor }) => onChange(normalizeEditorHtml(updatedEditor.getHTML()), "html"),
    editorProps: {
      attributes: {
        class: "article-rich-editor-content",
        spellcheck: "true",
      },
      handlePaste: (_view, event) => {
        const imageFiles = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file && file.type.startsWith("image/")));
        if (!imageFiles.length || !imageHandlerRef.current) return false;
        event.preventDefault();
        void insertImages(imageFiles);
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const nextContent = format === "markdown" ? markdownToHtml(value) : value;
    if (normalizeEditorHtml(editor.getHTML()) !== normalizeEditorHtml(nextContent)) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [editor, format, value]);

  const insertImages = useCallback(async (files: File[]) => {
    if (!imageHandlerRef.current) return;
    const images = await imageHandlerRef.current(files);
    if (!images.length || !editorRef.current) return;
    editorRef.current.chain().focus().insertContent(
      images.map((image) => ({ type: "image", attrs: { src: image.src, alt: image.alt, title: image.alt } })),
    ).run();
  }, []);

  function openResourceDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    selectionRef.current = { from, to };
    setResourcePoints(String(editor.getAttributes("resourceBlock").points ?? 10));
    setIsResourceDialogOpen(true);
  }

  function insertResourceBlock() {
    if (!editor) return;
    const points = Number(resourcePoints);
    if (!Number.isInteger(points) || points < 1 || points > 10000) {
      onError?.(phrase("积分必须是 1 到 10000 的整数。", "Points must be an integer from 1 to 10000."));
      return;
    }
    const selection = selectionRef.current;
    if (editor.isActive("resourceBlock")) {
      editor.chain().focus().updateAttributes("resourceBlock", { points }).run();
    } else if (selection && selection.from !== selection.to) {
      editor.chain().focus().setTextSelection(selection).wrapIn("resourceBlock", { points }).run();
    } else {
      editor.chain().focus().insertContent({ type: "resourceBlock", attrs: { points }, content: [{ type: "paragraph" }] }).run();
    }
    setIsResourceDialogOpen(false);
  }

  function removeResourceBlock() {
    if (!editor) return;
    editor.chain().focus().lift("resourceBlock").run();
    setIsResourceDialogOpen(false);
  }

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    selectionRef.current = { from, to };
    setLinkUrl(editor.getAttributes("link").href ?? "");
    setIsLinkDialogOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const valueToApply = linkUrl.trim();
    if (valueToApply && !isSafeLink(valueToApply)) {
      onError?.(phrase("链接地址不安全或格式不支持。", "This link is unsafe or unsupported."));
      return;
    }
    if (selectionRef.current) editor.chain().focus().setTextSelection(selectionRef.current).run();
    if (valueToApply) editor.chain().focus().setLink({ href: valueToApply }).run();
    else editor.chain().focus().unsetLink().run();
    setIsLinkDialogOpen(false);
  }

  if (!editor) return <div className="article-rich-editor-loading">{phrase("正在加载编辑器…", "Loading editor…")}</div>;

  const headingValue = editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "p";
  const toolbarButton = (label: string, icon: ReactNode, action: () => void, active = false, disabled = false) => (
    <button aria-label={label} className={active ? "active" : undefined} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={action} title={label} type="button">{icon}</button>
  );

  return (
    <div className="article-rich-editor">
      <div className="article-rich-toolbar" role="toolbar" aria-label={phrase("文章格式工具", "Article formatting tools")}>
        <select aria-label={phrase("文本层级", "Text level")} className="article-rich-heading-select" onChange={(event) => { const level = event.target.value; if (level === "p") editor.chain().focus().setParagraph().run(); else editor.chain().focus().toggleHeading({ level: Number(level) as 1 | 2 | 3 }).run(); }} value={headingValue}>
          <option value="p">{phrase("正文", "Text")}</option><option value="1">{phrase("标题 1", "Heading 1")}</option><option value="2">{phrase("标题 2", "Heading 2")}</option><option value="3">{phrase("标题 3", "Heading 3")}</option>
        </select>
        <span className="article-rich-toolbar-divider" />
        {toolbarButton(phrase("粗体", "Bold"), <Bold size={15} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {toolbarButton(phrase("斜体", "Italic"), <Italic size={15} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {toolbarButton(phrase("删除线", "Strikethrough"), <Strikethrough size={15} />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        {toolbarButton(phrase("下划线", "Underline"), <span className="article-rich-underlined">U</span>, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
        <span className="article-rich-toolbar-divider" />
        {toolbarButton(phrase("无序列表", "Bullet list"), <List size={15} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {toolbarButton(phrase("有序列表", "Ordered list"), <ListOrdered size={15} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {toolbarButton(phrase("任务列表", "Task list"), <ListChecks size={15} />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}
        {toolbarButton(phrase("引用", "Blockquote"), <Quote size={15} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {toolbarButton(phrase("代码块", "Code block"), <Code2 size={15} />, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
        {toolbarButton(phrase("分割线", "Horizontal rule"), <Minus size={15} />, () => editor.chain().focus().setHorizontalRule().run())}
        <span className="article-rich-toolbar-divider" />
        <button aria-label={phrase("插入链接", "Insert link")} className={editor.isActive("link") ? "active" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={openLinkDialog} title={phrase("插入链接", "Insert link")} type="button"><Link2 size={15} /></button>
        {toolbarButton(phrase("取消链接", "Remove link"), <Unlink size={15} />, () => editor.chain().focus().unsetLink().run(), false, !editor.isActive("link"))}
        {onImageFiles ? <button aria-label={phrase("插入图片", "Insert image")} onMouseDown={(event) => event.preventDefault()} onClick={() => imageInputRef.current?.click()} title={phrase("插入图片", "Insert image")} type="button"><ImagePlus size={15} /></button> : null}
        <button aria-label={phrase("插入积分资源", "Insert point resource")} className={editor.isActive("resourceBlock") ? "active" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={openResourceDialog} title={phrase("插入积分资源", "Insert point resource")} type="button"><Coins size={15} /></button>
        {onImageFiles ? <input accept="image/jpeg,image/png,image/webp,image/avif" hidden multiple onChange={(event) => { void insertImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} ref={imageInputRef} type="file" /> : null}
        <span className="article-rich-toolbar-spacer" />
        {toolbarButton(phrase("清除格式", "Clear formatting"), <RemoveFormatting size={15} />, () => editor.chain().focus().clearNodes().unsetAllMarks().run())}
        {toolbarButton(phrase("撤销", "Undo"), <Undo2 size={15} />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {toolbarButton(phrase("重做", "Redo"), <Redo2 size={15} />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </div>
      <EditorContent editor={editor} />

      {isResourceDialogOpen && typeof document !== "undefined" ? createPortal(
        <div className="modal-backdrop article-rich-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsResourceDialogOpen(false); }}>
          <section aria-modal="true" className="announcement-editor article-rich-dialog" role="dialog">
            <header><span><Coins aria-hidden="true" size={17} /><strong>{phrase("插入积分资源", "Insert point resource")}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={() => setIsResourceDialogOpen(false)} title={phrase("关闭", "Close")} type="button"><X size={17} /></button></header>
            <div className="announcement-editor-body"><p className="wide">{phrase("选中的内容会变成需要积分兑换的区块；没有选中内容时会插入一个新的资源区块。", "Selected content becomes a point-gated block. With no selection, a new resource block is inserted.")}</p><label><span>{phrase("兑换积分", "Points required")}</span><input autoFocus inputMode="numeric" max={10000} min={1} onChange={(event) => setResourcePoints(event.target.value)} type="number" value={resourcePoints} /></label></div>
            <footer>{editor.isActive("resourceBlock") ? <button aria-label={phrase("移除资源标记", "Remove resource marker")} className="article-template-icon-button danger" onClick={removeResourceBlock} title={phrase("移除资源标记", "Remove resource marker")} type="button"><RemoveFormatting size={17} /></button> : null}<button aria-label={phrase("取消", "Cancel")} className="article-template-icon-button" onClick={() => setIsResourceDialogOpen(false)} title={phrase("取消", "Cancel")} type="button"><X size={17} /></button><button aria-label={phrase("确定", "Confirm")} className="article-template-icon-button primary" onClick={insertResourceBlock} title={phrase("确定", "Confirm")} type="button"><Coins size={17} /></button></footer>
          </section>
        </div>, document.body,
      ) : null}
      {isLinkDialogOpen && typeof document !== "undefined" ? createPortal(
        <div className="modal-backdrop article-rich-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsLinkDialogOpen(false); }}>
          <section aria-modal="true" className="announcement-editor article-rich-dialog" role="dialog">
            <header><span><Link2 aria-hidden="true" size={17} /><strong>{phrase("设置链接", "Set link")}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={() => setIsLinkDialogOpen(false)} title={phrase("关闭", "Close")} type="button"><X size={17} /></button></header>
            <div className="announcement-editor-body"><label><span>{phrase("链接地址", "Link URL")}</span><input autoFocus onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" type="url" value={linkUrl} /></label></div>
            <footer><button aria-label={phrase("取消", "Cancel")} className="article-template-icon-button" onClick={() => setIsLinkDialogOpen(false)} title={phrase("取消", "Cancel")} type="button"><X size={17} /></button><button aria-label={phrase("确定", "Confirm")} className="article-template-icon-button primary" onClick={applyLink} title={phrase("确定", "Confirm")} type="button"><Link2 size={17} /></button></footer>
          </section>
        </div>, document.body,
      ) : null}
    </div>
  );
}

function markdownToHtml(value: string): string {
  if (!value.trim()) return "";
  return String(marked.parse(value, { breaks: true, gfm: true, async: false }));
}

function normalizeEditorHtml(value: string): string {
  return value.replace(/<p>(?:<br>)?<\/p>$/i, "").trim();
}

function isSafeLink(value: string): boolean {
  return value.startsWith("/") || /^https?:\/\//i.test(value) || /^mailto:/i.test(value);
}
