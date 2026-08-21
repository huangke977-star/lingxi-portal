"use client";

import { Download, FileText, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppToast } from "@/components/app-toast";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  downloadChatAttachment,
  downloadChatAttachmentThumbnail,
  type ChatAttachment,
} from "@/lib/social-api";

interface ReportPreviewUser {
  nickname: string;
  avatarUrl: string | null;
}

interface ReportPreviewGroup {
  name: string;
  avatarUrl: string | null;
}

interface ReportPreviewMessage {
  body: string;
  createdAt: string;
  sender: ReportPreviewUser;
  senderDisplayName?: string;
  attachments: ChatAttachment[];
}

export function GroupReportMessagePreview({ group, message, onClose }: { group: ReportPreviewGroup; message: ReportPreviewMessage; onClose: () => void }) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const images = message.attachments.filter((attachment) => attachment.kind === "image");
  const otherAttachments = message.attachments.filter((attachment) => attachment.kind !== "image");
  if (typeof document === "undefined") return null;

  return createPortal(<>
    <div className="group-management-preview-backdrop" onClick={onClose} role="presentation">
      <section aria-modal="true" className="group-management-preview" onClick={(event) => event.stopPropagation()} role="dialog">
        <header><span className="report-admin-group"><GroupAvatar group={group} /><strong>{group.name} · 被举报内容</strong></span><button aria-label="关闭内容预览" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button></header>
        <div className="group-management-preview-content"><div className="chat-message theirs group-report-preview-message"><span className="chat-message-sender"><UserAvatar user={message.sender} /><small>{message.senderDisplayName || message.sender.nickname}</small></span><div>{images.length ? <div className={`chat-message-attachments chat-message-images count-${images.length}`}>{images.map((attachment) => <ReportMessageImage attachment={attachment} key={attachment.id} onPreview={() => setPreviewAttachment(attachment)} />)}</div> : null}{otherAttachments.length ? <div className={`chat-message-attachments chat-message-files${otherAttachments.length === 1 && otherAttachments[0].kind === "audio" ? " audio-only" : ""}`}>{otherAttachments.map((attachment) => attachment.kind === "audio" || attachment.kind === "video" ? <ReportMessageMedia attachment={attachment} key={attachment.id} /> : <ReportMessageFile attachment={attachment} key={attachment.id} />)}</div> : null}{message.body ? <p>{message.body}</p> : null}<span>{formatMinute(message.createdAt)}</span></div></div></div>
      </section>
    </div>
    {previewAttachment ? <ReportAttachmentPreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} /> : null}
  </>, document.body);
}

function ReportMessageImage({ attachment, onPreview }: { attachment: ChatAttachment; onPreview: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachmentThumbnail(token, attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment]);
  return <button className="chat-image-attachment" disabled={!url} onClick={onPreview} type="button">{url ? <img alt={attachment.originalName} src={url} /> : <ImageIcon aria-hidden="true" size={22} />}</button>;
}

function ReportMessageMedia({ attachment }: { attachment: ChatAttachment }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachment(token, attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
    }).catch((mediaError) => {
      if (active) setError(mediaError instanceof Error ? mediaError.message : "媒体读取失败。");
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  if (!previewUrl) return <><span className="chat-media-loading">{error ? "媒体暂时无法读取" : <LoaderCircle aria-hidden="true" className="spin" size={18} />}</span><AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
  return <>{attachment.kind === "audio" ? <audio className="chat-audio-attachment" controls onEnded={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} preload="metadata" src={previewUrl} /> : <video className="chat-video-attachment" controls playsInline preload="metadata" src={previewUrl} />}<AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
}

function ReportMessageFile({ attachment }: { attachment: ChatAttachment }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    const token = readAccessToken();
    if (!token || isDownloading) return;
    setIsDownloading(true);
    try {
      const blob = await downloadChatAttachment(token, attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "附件下载失败。");
    } finally {
      setIsDownloading(false);
    }
  }
  return <><button className="chat-file-attachment" onClick={() => void download()} type="button"><FileText aria-hidden="true" size={22} /><span><strong title={attachment.originalName}>{attachment.originalName}</strong><small>{formatBytes(attachment.sizeBytes)}</small></span>{isDownloading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Download aria-hidden="true" size={16} />}</button><AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
}

function ReportAttachmentPreview({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let objectUrl = "";
    downloadChatAttachment(token, attachment).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((previewError) => setError(previewError instanceof Error ? previewError.message : "附件预览失败。"));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment]);
  return <><div className="chat-attachment-preview" onClick={onClose} role="presentation"><button aria-label="关闭图片预览" onClick={onClose} type="button"><X aria-hidden="true" size={22} /></button>{url ? <img alt={attachment.originalName} onClick={(event) => event.stopPropagation()} src={url} /> : error ? <span>{error}</span> : <LoaderCircle aria-hidden="true" className="spin" size={26} />}</div><AppToast duration={4200} message={error} onDismiss={() => setError("")} tone="error" /></>;
}

function UserAvatar({ user }: { user: ReportPreviewUser }) {
  return <span className="chat-user-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : fallbackText(user.nickname)}</span>;
}

function GroupAvatar({ group }: { group: ReportPreviewGroup }) {
  return <span className="group-admin-avatar group-admin-group-avatar">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <strong>{fallbackText(group.name)}</strong>}</span>;
}

function fallbackText(value: string): string {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "群";
}

function formatMinute(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
