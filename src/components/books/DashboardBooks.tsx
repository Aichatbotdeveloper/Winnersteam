import Link from "next/link";
import { Badge, Card, CardHeader, Icon, Progress, buttonClass } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/client";
import { BookCover } from "@/components/books/BookCover";
import { dismissRecommendation, setReading } from "@/server/actions/books";

export type ShelfBook = { id: string; title: string; author: string; cover_url: string | null; reading_url: string | null; free_download_url: string | null; license: string; improvement_area: string | null };
export type ShelfRec = { id: string; weakness: string; reason: string; book: ShelfBook };
export type ShelfReading = { progress_pct: number; book: ShelfBook };

function Tile({ book, label, children }: { book: ShelfBook; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border-subtle bg-surface-alt/40 p-3">
      <div className="w-16 shrink-0 overflow-hidden rounded-md shadow-card sm:w-20"><BookCover title={book.title} author={book.author} src={book.cover_url} /></div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1">{label}</div>
        <div className="font-heading text-body-lg leading-snug text-ink">{book.title}</div>
        <div className="text-body-sm text-muted-text">{book.author}</div>
        <div className="mt-auto pt-2">{children}</div>
      </div>
    </div>
  );
}

function ReadLink({ book }: { book: ShelfBook }) {
  const href = book.free_download_url ?? book.reading_url;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
      <Icon name={book.free_download_url ? "download" : "open_in_new"} className="text-[16px]" />{book.free_download_url ? "Read free" : book.license === "commercial" ? "Where to get it" : "Open"}
    </a>
  );
}

/** Dashboard reading card: current book, books recommended from recent scores, or a Book of the week. */
export function DashboardBooks({ reading, recs, bookOfWeek }: { reading: ShelfReading | null; recs: ShelfRec[]; bookOfWeek: ShelfBook | null }) {
  const shown = recs.slice(0, reading ? 2 : 3);
  return (
    <Card className="p-5">
      <CardHeader icon="menu_book" eyebrow="Personal development"
        title={shown.length ? "Recommended for you" : reading ? "Your reading" : "Book of the week"}
        action={<Link href="/books" className="text-body-sm font-semibold text-secondary hover:underline">Open library →</Link>} />
      {shown.length > 0 && <p className="mt-1 text-body-sm text-muted-text">Picked from your recent checklist scores to help you improve where it matters most.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reading && (
          <Tile book={reading.book} label={<Badge tone="green" dot>Currently reading</Badge>}>
            <div className="flex items-center gap-2"><Progress value={reading.progress_pct} color="var(--color-accent-emerald)" /><span className="text-body-sm font-semibold text-ink">{reading.progress_pct}%</span></div>
            <div className="mt-2 flex flex-wrap gap-2"><ReadLink book={reading.book} /><Link href="/books?tab=list" className={buttonClass("ghost", "sm")}>Update progress</Link></div>
          </Tile>
        )}
        {shown.map((r) => (
          <Tile key={r.id} book={r.book} label={<Badge tone="purple">{r.weakness}</Badge>}>
            <p className="line-clamp-2 text-body-sm text-muted-text">{r.reason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ConfirmAction action={setReading} fields={{ book_id: r.book.id, status: "reading", progress_pct: "0" }} label="Start reading" icon="play_arrow" variant="secondary" />
              <ReadLink book={r.book} />
              <ConfirmAction action={dismissRecommendation} fields={{ id: r.id }} label="Not for me" variant="ghost" />
            </div>
          </Tile>
        ))}
        {!reading && shown.length === 0 && bookOfWeek && (
          <Tile book={bookOfWeek} label={<Badge tone="blue">Book of the week</Badge>}>
            {bookOfWeek.improvement_area && <p className="text-body-sm text-muted-text">Good for: {bookOfWeek.improvement_area}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <ConfirmAction action={setReading} fields={{ book_id: bookOfWeek.id, status: "reading", progress_pct: "0" }} label="Start reading" icon="play_arrow" variant="secondary" />
              <ReadLink book={bookOfWeek} />
            </div>
          </Tile>
        )}
      </div>
    </Card>
  );
}
