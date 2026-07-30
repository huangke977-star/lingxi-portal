export interface AndroidReleaseResponse {
  id: number;
  versionName: string;
  versionCode: number;
  channel: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  apkUrl: string;
  releaseNotes: string[];
  isActive: boolean;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}
