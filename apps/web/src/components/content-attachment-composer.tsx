import { Download, FileAudio, FileText, FileVideo, ImageIcon, LoaderCircle, Send, Upload, X } from "lucide-react";
import { useEffect, useState, type ClipboardEvent, type DragEvent, type FormEvent, type RefObject } from "react";
import { AppToast } from "@/components/app-toast";
import { requestBlob } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import type { ContentAttachment } from "@/lib/content-attachments";
import { useLanguage } from "@/components/language-provider";

const MAX_ATTACHMENTS = 9;
const MAX_BATCH_SIZE = 50 * 1024 * 1024;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set(["bat", "cmd", "com", "cpl", "exe", "hta", "jar", "js", "jse", "msi", "msp", "pif", "ps1", "scr", "sh", "vbe", "vbs", "wsf", "wsh"]);

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
  kind: ContentAttachment["kind"];
}

export function ContentAttachmentComposer({
  ariaLabel,
  disabled = false,
  isSubmitting = false,
  onChange,
  onSubmit,
  placeholder,
  textareaRef,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  onChange: (value: string) => void;
  onSubmit: (files: File[]) => Promise<boolean>;
  placeholder: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const { phrase, t } = useLanguage();
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");

  function validate(files: File[]): boolean {
    if (files.length + pending.length > MAX_ATTACHMENTS) {
      setError(phrase(`每条消息最多添加 ${MAX_ATTACHMENTS} 个图片或文件。`, `Each message can include up to ${MAX_ATTACHMENTS} images or files.`));
      return false;
    }
    if ([...pending.map((item) => item.file), ...files].reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      setError(phrase("一条消息的附件总大小不能超过 50MB。", "Attachments in one message cannot exceed 50 MB in total."));
      return false;
    }
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      const isVideo = file.type.startsWith("video/");
      if (BLOCKED_EXTENSIONS.has(extension)) {
        setError(phrase(`不允许发送可执行文件或脚本：${file.name}`, `Executable files or scripts cannot be sent: ${file.name}`));
        return false;
      }
      const limit = isImage ? MAX_IMAGE_SIZE : isAudio ? MAX_AUDIO_SIZE : isVideo ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
      if (file.size > limit) {
        setError(phrase(`文件过大：${file.name}`, `File is too large: ${file.name}`));
        return false;
      }
    }
    return true;
  }

  function addFiles(files: File[]) {
    if (disabled || !files.length || !validate(files)) return;
    setPending((current) => [...current, ...files.map((file) => ({
      id: `${Date.now()}-${crypto.randomUUID()}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      kind: file.type.startsWith("image/") ? "image" as const : file.type.startsWith("audio/") ? "audio" as const : file.type.startsWith("video/") ? "video" as const : "file" as const,
    }))]);
  }

  function removeFile(id: string) {
    setPending((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((candidate) => candidate.id !== id);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSubmitting || (!value.trim() && !pending.length)) return;
    const success = await onSubmit(pending.map((item) => item.file));
    if (!success) return;
    pending.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setPending([]);
    onChange("");
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).length
      ? Array.from(event.clipboardData.files)
      : Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  }

  return <>
    <form className="content-attachment-composer" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} onSubmit={submit}>
      {pending.length ? <div className="chat-pending-attachments">{pending.map((item) => <span key={item.id}>{item.previewUrl ? <img alt="" src={item.previewUrl} /> : item.kind === "audio" ? <FileAudio aria-hidden="true" size={24} /> : item.kind === "video" ? <FileVideo aria-hidden="true" size={24} /> : <FileText aria-hidden="true" size={22} />}<small title={item.file.name}>{item.file.name}</small><button aria-label={phrase(`移除 ${item.file.name}`, `Remove ${item.file.name}`)} onClick={() => removeFile(item.id)} type="button"><X aria-hidden="true" size={13} /></button></span>)}</div> : null}
      <div className="content-attachment-input-wrap">
        <input accept=".jpg,.jpeg,.png,.webp,.webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.rtf,.zip,.rar,.7z,.gz,.tar" hidden multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" />
        <textarea aria-label={ariaLabel} disabled={disabled} maxLength={2000} onChange={(event) => onChange(event.target.value)} onPaste={handlePaste} placeholder={placeholder} ref={textareaRef} rows={3} value={value} />
        <div className="content-attachment-actions">
          <button aria-label={phrase("上传图片或文件", "Upload images or files")} disabled={disabled || isSubmitting} onClick={(event) => { const input = event.currentTarget.closest(".content-attachment-input-wrap")?.querySelector<HTMLInputElement>("input[type=file]"); input?.click(); }} title={phrase("上传图片或文件", "Upload images or files")} type="button"><Upload aria-hidden="true" size={16} /></button>
          <button aria-label={t("common.send")} disabled={disabled || isSubmitting || (!value.trim() && !pending.length)} title={t("common.send")} type="submit">{isSubmitting ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Send aria-hidden="true" size={16} />}</button>
        </div>
      </div>
    </form>
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </>;
}

export function ContentAttachmentList({ attachments }: { attachments: ContentAttachment[] }) {
  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  const [preview, setPreview] = useState<ContentAttachment | null>(null);
  return <>
    {images.length ? <div className={`chat-message-attachments chat-message-images count-${images.length}`}>{images.map((attachment) => <ContentImageAttachment attachment={attachment} key={attachment.id} onPreview={() => setPreview(attachment)} />)}</div> : null}
    {files.length ? <div className="chat-message-attachments chat-message-files">{files.map((attachment) => attachment.kind === "audio" || attachment.kind === "video" ? <ContentMediaAttachment attachment={attachment} key={attachment.id} /> : <ContentFileAttachment attachment={attachment} key={attachment.id} />)}</div> : null}
    {preview ? <ContentImagePreview attachment={preview} onClose={() => setPreview(null)} /> : null}
  </>;
}

function ContentImageAttachment({ attachment, onPreview }: { attachment: ContentAttachment; onPreview: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void loadAttachmentBlob(attachment.thumbnailUrl ?? attachment.downloadUrl).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment]);
  return <button className="chat-image-attachment" disabled={!url} onClick={onPreview} type="button">{url ? <img alt={attachment.originalName} src={url} /> : <ImageIcon aria-hidden="true" size={22} />}</button>;
}

function ContentMediaAttachment({ attachment }: { attachment: ContentAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void loadAttachmentBlob(attachment.downloadUrl).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment]);
  if (!url) return <span className="chat-media-loading"><LoaderCircle aria-hidden="true" className="spin" size={18} /></span>;
  return attachment.kind === "audio" ? <audio className="chat-audio-attachment" controls preload="metadata" src={url} /> : <video className="chat-video-attachment" controls playsInline preload="metadata" src={url} />;
}

function ContentFileAttachment({ attachment }: { attachment: ContentAttachment }) {
  const [isDownloading, setIsDownloading] = useState(false);
  async function download() {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const blob = await loadAttachmentBlob(attachment.downloadUrl);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // The content row remains usable when a protected attachment is unavailable.
    } finally {
      setIsDownloading(false);
    }
  }
  return <button className="chat-file-attachment" onClick={() => void download()} type="button"><FileText aria-hidden="true" size={22} /><span><strong title={attachment.originalName}>{attachment.originalName}</strong><small>{formatFileSize(attachment.sizeBytes)}</small></span>{isDownloading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Download aria-hidden="true" size={16} />}</button>;
}

function ContentImagePreview({ attachment, onClose }: { attachment: ContentAttachment; onClose: () => void }) {
  const { phrase } = useLanguage();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    void loadAttachmentBlob(attachment.downloadUrl).then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => onClose());
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, onClose]);
  return <div className="chat-attachment-preview" onClick={onClose} role="presentation"><button aria-label={phrase("关闭预览", "Close preview")} onClick={onClose} title={phrase("关闭预览", "Close preview")} type="button"><X aria-hidden="true" size={22} /></button>{url ? <img alt={attachment.originalName} onClick={(event) => event.stopPropagation()} src={url} /> : <LoaderCircle aria-hidden="true" className="spin" size={26} />}</div>;
}

async function loadAttachmentBlob(path: string): Promise<Blob> {
  const token = readAccessToken();
  return requestBlob(path, token ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" } : { cache: "no-store" });
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
