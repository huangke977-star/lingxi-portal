export interface ContentAttachment {
  id: number;
  kind: "image" | "file" | "audio" | "video";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
}
