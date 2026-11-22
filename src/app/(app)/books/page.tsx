import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardHeader, EmptyState, Icon, PageHeader, StatTile, Tabs, cn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { BookCard, type Book, type Progress } from "@/components/books/BookCard";
import { refreshRecommendations } from "@/server/actions/books";

export const metadata: Metadata = { title: "Books & Reading" };

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const tab = ["recommended", "reading-list", "library"].includes(sp.tab ?? "") ? sp.tab! : "recommended";
  const supabase = await createClient();
  const [books, recs, progress, notes, cats, weak] = await Promise.all([
    supabase.from("books").select("*").eq("active", true).order("title"),
    supabase.from("book_recommendations").select("*").eq("user_id", me.id).is("dismissed_at", null).order("created_at", { ascending: false }),
    supabase.from("reading_progress").select("*").eq("user_id", me.id),
    supabase.from("reading_notes").select("id,book_id,note,created_at").order("created_at", { ascending: false }),
    supabase.from("learning_categories").select("*").order("name"),
    supabase.rpc("my_weaknesses"),
  ]);
  const byId = new Map((books.data ?? []).map((b) => [b.id, b as Book]));
  const prog = new Map((progress.data ?? []).map((p) => [p.book_id, p as unknown as NonNullable<Progress>]));
  const notesBy = new Map<string, { id: string; note: string; created_at: string }[]>();
  for (const n of notes.data ?? []) notesBy.set(n.book_id, [...(notesBy.get(n.book_id) ?? []), n]);
  const list = (progress.data ?? []);
  const card = (b: Book, extra?: { reason?: string; recId?: string }) => <BookCard key={b.id + (extra?.recId ?? "")} book={b} progress={prog.get(b.id)} notes={notesBy.get(b.id)} {...extra} />;

  return (
    <>
      <PageHeader eyebrow="Personal development" title="Recommended Books & Reading" description="Reading tailored to recurring patterns in your performance history. Public-domain and open-access titles include legal free links — no pirated copies."
        actions={<ActionForm action={refreshRecommendations}><SubmitButton icon="auto_awesome" variant="secondary">Refresh my recommendations</SubmitButton></ActionForm>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recommended for you" value={(recs.data ?? []).length} icon="recommend" />
        <StatTile label="Currently reading" value={list.filter((p) => p.status === "reading").length} icon="auto_stories" tone="blue" />
        <StatTile label="Completed" value={list.filter((p) => p.status === "completed").length} icon="task_alt" tone="green" />
        <StatTile label="Want to read" value={list.filter((p) => p.status === "want_to_read").length} icon="bookmark" tone="amber" />
      </div>
      <Card className="mb-5 p-5">
        <CardHeader icon="psychology" title="Identified improvement areas" eyebrow="From your last 4 weeks of recorded performance (not single misses)" />
        {(weak.data ?? []).length === 0 ? <p className="mt-3 text-body-md text-muted-text">No recurring weaknesses detected. Keep it up! Recommendations will appear here if a pattern emerges.</p> : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(weak.data ?? []).map((w) => (
              <div key={w.category} className="flex gap-3 rounded-xl bg-surface-alt p-3">
                <Icon name="trending_down" className="text-accent-amber" />
                <div><div className="text-label-md text-ink">{w.weakness}</div><div className="text-body-sm text-muted-text">{w.explanation}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Tabs active={tab} items={[
        { key: "recommended", href: "/books?tab=recommended", label: "Recommended", icon: "recommend" },
        { key: "reading-list", href: "/books?tab=reading-list", label: "My reading list", icon: "bookmarks" },
        { key: "library", href: "/books?tab=library", label: "Library", icon: "local_library" },
      ]} />
      {tab === "recommended" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {(recs.data ?? []).length === 0 ? <div className="lg:col-span-2"><EmptyState icon="recommend" title="No recommendations yet">Recommendations are generated weekly from your performance history, or press “Refresh my recommendations”.</EmptyState></div>
            : (recs.data ?? []).map((r) => byId.get(r.book_id) && card(byId.get(r.book_id)!, { reason: r.reason, recId: r.id }))}
        </div>
      )}
      {tab === "reading-list" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.length === 0 ? <div className="lg:col-span-2"><EmptyState icon="bookmarks" title="Your reading list is empty">Add books from Recommended or the Library.</EmptyState></div>
            : [...list].sort((a, b) => ["reading", "want_to_read", "completed"].indexOf(a.status) - ["reading", "want_to_read", "completed"].indexOf(b.status)).map((p) => byId.get(p.book_id) && card(byId.get(p.book_id)!))}
        </div>
      )}
      {tab === "library" && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Link href="/books?tab=library" className={cn("rounded-lg px-2.5 py-1 text-body-sm", !sp.category ? "bg-secondary text-on-secondary" : "bg-surface text-muted-text shadow-card")}>All</Link>
            {(cats.data ?? []).map((c) => <Link key={c.slug} href={`/books?tab=library&category=${c.slug}`} className={cn("rounded-lg px-2.5 py-1 text-body-sm", sp.category === c.slug ? "bg-secondary text-on-secondary" : "bg-surface text-muted-text shadow-card")}>{c.name}</Link>)}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(books.data ?? []).filter((b) => !sp.category || b.category === sp.category).map((b) => card(b as Book))}
          </div>
        </>
      )}
      <p className="mt-5 flex items-center gap-1.5 text-body-sm text-muted-text"><Badge tone="green">Copyright</Badge>Only public-domain and open-access works carry free links. Commercial titles are listed for borrowing or purchase.</p>
    </>
  );
}
