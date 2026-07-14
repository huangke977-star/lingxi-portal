export interface UploadedBackgroundFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface BackgroundImageResponse {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  url: string;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
