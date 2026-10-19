import type { ImagePreparationProfile } from "@yep-anywhere/shared";

const RESIZABLE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function getBaseFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return fileName;
  }
  return fileName.slice(0, lastDot);
}

function getOutputMimeType(mimeType: string): string {
  if (!RESIZABLE_IMAGE_MIME_TYPES.has(mimeType)) {
    return "image/jpeg";
  }
  switch (mimeType) {
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/png";
    default:
      return mimeType;
  }
}

function getOutputExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

function getResizedFileName(fileName: string, outputMimeType: string): string {
  return `${getBaseFileName(fileName)}-resized.${getOutputExtension(outputMimeType)}`;
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality / 100);
  });
}

export interface PreparedImageUpload {
  file: File;
  width?: number;
  height?: number;
}

export async function prepareImageUpload(
  file: File,
  profile: ImagePreparationProfile,
): Promise<PreparedImageUpload> {
  if (typeof createImageBitmap !== "function") {
    return { file };
  }
  if (!file.type.startsWith("image/")) {
    return { file };
  }
  if (!RESIZABLE_IMAGE_MIME_TYPES.has(file.type)) {
    return { file };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= profile.maxLongEdge && file.size <= profile.maxBytes) {
      return { file, ...dimensions };
    }

    let scale = Math.min(1, profile.maxLongEdge / longEdge);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Image preparation requires a canvas context");
    }
    const outputMimeType = getOutputMimeType(file.type);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await blobFromCanvas(
        canvas,
        outputMimeType,
        profile.quality,
      );
      if (!blob)
        throw new Error("Image preparation failed to encode the image");
      if (blob.size <= profile.maxBytes) {
        const finalMimeType = blob.type || outputMimeType;
        return {
          file: new File([blob], getResizedFileName(file.name, finalMimeType), {
            type: finalMimeType,
            lastModified: file.lastModified,
          }),
          width,
          height,
        };
      }
      scale *= 0.8;
    }
    throw new Error("Image preparation could not meet the upload size limit");
  } finally {
    bitmap?.close();
  }
}

export async function resizeImageFile(
  file: File,
  profile: ImagePreparationProfile,
): Promise<File> {
  return (await prepareImageUpload(file, profile)).file;
}
