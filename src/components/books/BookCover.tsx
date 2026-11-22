"use client";

import { useState } from "react";

const COVER = ["#5a45cb", "#0091FF", "#10B981", "#F59E0B", "#8B5CF6", "#202020"];

/** Real cover when available; falls back to a generated cover if the image is missing or fails to load. */
export function BookCover({ title, author, src }: { title: string; author: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`Cover of ${title}`} loading="lazy" onError={() => setFailed(true)}
      className="h-28 w-20 shrink-0 rounded-md bg-surface-alt object-cover shadow-card" />;
  }
  const color = COVER[[...title].reduce((s, ch) => s + ch.charCodeAt(0), 0) % COVER.length];
  return (
    <div className="flex h-28 w-20 shrink-0 flex-col justify-between rounded-md p-2 text-white shadow-card" style={{ background: color }} aria-hidden>
      <span className="line-clamp-4 font-heading text-[11px] font-bold leading-tight">{title}</span>
      <span className="truncate text-[9px] opacity-80">{author}</span>
    </div>
  );
}
