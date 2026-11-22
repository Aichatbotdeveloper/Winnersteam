import { Badge, Icon, Progress, cn } from "@/components/ui";
import { ActionForm, ConfirmAction, ModalButton, SubmitButton } from "@/components/ui/client";
import { addReadingNote, dismissRecommendation, removeFromList, setReading } from "@/server/actions/books";

export type Book = { id: string; title: string; author: string; category: string; improvement_area: string; description: string | null;
  cover_url: string | null; reading_url: string | null; free_download_url: string | null; license: "public_domain" | "open_access" | "commercial" };
export type Progress = { status: "want_to_read" | "reading" | "completed"; progress_pct: number } | undefined;

const LICENSE = { public_domain: ["Public domain", "green"], open_access: ["Open access", "blue"], commercial: ["Commercial — borrow or buy", "neutral"] } as const;
const COVER = ["#5a45cb", "#0091FF", "#10B981", "#F59E0B", "#8B5CF6", "#202020"];

/** Generated cover (no copyrighted cover art is fetched). */
function Cover({ book }: { book: Book }) {
  const color = COVER[[...book.title].reduce((s, c) => s + c.charCodeAt(0), 0) % COVER.length];
  // eslint-disable-next-line @next/next/no-img-element
  if (book.cover_url) return <img src={book.cover_url} alt="" className="h-28 w-20 shrink-0 rounded-md object-cover shadow-card" />;
  return (
    <div className="flex h-28 w-20 shrink-0 flex-col justify-between rounded-md p-2 text-white shadow-card" style={{ background: color }} aria-hidden>
      <span className="line-clamp-4 font-heading text-[11px] font-bold leading-tight">{book.title}</span>
      <span className="truncate text-[9px] opacity-80">{book.author}</span>
    </div>
  );
}

export function BookCard({ book, progress, reason, recId, notes }: { book: Book; progress: Progress; reason?: string; recId?: string; notes?: { id: string; note: string; created_at: string }[] }) {
  const [lic, tone] = LICENSE[book.license];
  return (
    <div className={cn("flex gap-4 rounded-xl border border-border-subtle bg-surface p-4", reason && "border-secondary/40 bg-surface-container-low/40")}>
      <Cover book={book} />
      <div className="min-w-0 flex-1">
        <div className="font-heading text-body-lg text-ink">{book.title}</div>
        <div className="text-body-sm text-muted-text">{book.author}</div>
        <div className="mt-1 flex flex-wrap gap-1"><Badge tone="purple">{book.improvement_area}</Badge><Badge tone={tone}>{lic}</Badge></div>
        {reason && <p className="mt-2 flex gap-1 text-body-sm text-secondary"><Icon name="lightbulb" className="text-[16px]" />Why: {reason}</p>}
        {book.description && <p className="mt-1.5 line-clamp-2 text-body-sm text-muted-text">{book.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-body-sm">
          {book.reading_url && <a href={book.reading_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-semibold text-link hover:underline"><Icon name="open_in_new" className="text-[15px]" />Read online</a>}
          {book.free_download_url && <a href={book.free_download_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-semibold text-on-tertiary-container hover:underline"><Icon name="download" className="text-[15px]" />Legal free download</a>}
        </div>
        {progress && (
          <div className="mt-3 flex items-center gap-2">
            <Badge tone={progress.status === "completed" ? "green" : progress.status === "reading" ? "blue" : "neutral"}>{progress.status.replace(/_/g, " ")}</Badge>
            <Progress value={progress.progress_pct} color="var(--color-accent-emerald)" /><span className="text-body-sm font-semibold">{progress.progress_pct}%</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {!progress && (
            <ActionForm action={setReading} showMessage={false}>
              <input type="hidden" name="book_id" value={book.id} /><input type="hidden" name="status" value="want_to_read" />
              <SubmitButton size="sm" variant="outline" icon="bookmark_add">Add to reading list</SubmitButton>
            </ActionForm>
          )}
          {progress && progress.status !== "completed" && (
            <ModalButton label="Update progress" title={`Reading progress — ${book.title}`} icon="trending_up" size="sm" variant="outline">
              <ActionForm action={setReading} className="space-y-3">
                <input type="hidden" name="book_id" value={book.id} />
                <label className="block"><span className="label">Status</span>
                  <select name="status" defaultValue={progress.status === "want_to_read" ? "reading" : progress.status} className="input">
                    <option value="want_to_read">Want to read</option><option value="reading">Currently reading</option><option value="completed">Completed</option>
                  </select></label>
                <label className="block"><span className="label">Progress (%)</span><input name="progress_pct" type="number" min={0} max={100} defaultValue={progress.progress_pct} className="input" /></label>
                <div className="flex justify-end"><SubmitButton icon="save">Save</SubmitButton></div>
              </ActionForm>
            </ModalButton>
          )}
          {progress && (
            <ModalButton label={`Notes${notes?.length ? ` (${notes.length})` : ""}`} title={`My notes — ${book.title}`} icon="edit_note" size="sm" variant="ghost">
              <ActionForm action={addReadingNote} resetOnSuccess className="space-y-2">
                <input type="hidden" name="book_id" value={book.id} />
                <textarea name="note" rows={3} maxLength={4000} required className="input" placeholder="Key idea, quote or action point…" />
                <div className="flex justify-end"><SubmitButton size="sm" icon="add">Add note</SubmitButton></div>
              </ActionForm>
              <ul className="mt-4 space-y-2">{(notes ?? []).map((n) => <li key={n.id} className="rounded-lg bg-surface-alt px-3 py-2 text-body-md">{n.note}<div className="text-[11px] text-faint-text">{new Date(n.created_at).toLocaleDateString("en-GB")}</div></li>)}</ul>
            </ModalButton>
          )}
          {progress && <ConfirmAction action={removeFromList} label="Remove" icon="close" variant="ghost" fields={{ book_id: book.id }} />}
          {recId && <ConfirmAction action={dismissRecommendation} label="Dismiss" icon="thumb_down" variant="ghost" fields={{ id: recId }} />}
        </div>
      </div>
    </div>
  );
}
