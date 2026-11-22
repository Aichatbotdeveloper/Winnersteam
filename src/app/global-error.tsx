"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-GB"><body style={{ fontFamily: "Inter, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#F9FAFB" }}>
      <div style={{ textAlign: "center" }}><h1>Winners Team is temporarily unavailable</h1><button onClick={reset} style={{ padding: "8px 16px", background: "#080808", color: "#fff", borderRadius: 6 }}>Try again</button></div>
    </body></html>
  );
}
