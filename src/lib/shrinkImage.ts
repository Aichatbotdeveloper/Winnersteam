"use client";

import type { ChangeEvent } from "react";

/**
 * Shrink a photo in the browser before upload: longest side ≤ maxSide, saved as JPEG.
 * Returns the original file if it is not a PNG/JPEG/WebP image, the browser can't
 * process it, or shrinking wouldn't make it smaller.
 */
export async function shrinkImage(file: File, maxSide: number, quality = 0.82): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); // transparent PNGs get a white background
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** onChange handler for <input type="file">: swaps the chosen photo for a shrunk copy. */
export function shrinkOnSelect(maxSide: number, onState?: (busy: boolean) => void) {
  return async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    onState?.(true);
    try {
      const small = await shrinkImage(file, maxSide);
      if (small !== file && typeof DataTransfer !== "undefined") {
        const dt = new DataTransfer();
        dt.items.add(small);
        input.files = dt.files;
      }
    } finally {
      onState?.(false);
    }
  };
}
