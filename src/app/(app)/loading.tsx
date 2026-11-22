export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-24 rounded-xl bg-surface-alt" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-surface-alt" />)}</div>
      <div className="h-72 rounded-xl bg-surface-alt" />
    </div>
  );
}
