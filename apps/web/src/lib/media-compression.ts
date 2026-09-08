const IMAGE_COMPRESSION_THRESHOLD = 1.5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2400;

/** Compresses large lossy images before upload without changing small files or transparent PNGs. */
export async function compressImageForUpload(file: File): Promise<File> {
  if (typeof window === "undefined" || !file.type.startsWith("image/") || file.size < IMAGE_COMPRESSION_THRESHOLD) return file;
  if (file.type === "image/png" || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const source = await loadImage(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(source, 0, 0, width, height);
    const outputType = file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.84));
    if (!compressed || compressed.size >= file.size) return file;
    return new File([compressed], file.name, { type: outputType, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
