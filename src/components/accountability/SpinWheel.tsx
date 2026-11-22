"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, cn } from "@/components/ui";
import { CONSEQUENCE_COLOR, CONSEQUENCE_ICON, consequenceText, sectorLabel } from "@/lib/labels";
import { spinAccountability, type SpinResult } from "@/server/actions/accountability";

type Sector = { option_id: string; category: keyof typeof CONSEQUENCE_COLOR; quantity: number; unit: string; weight: number };

/** Lighten/darken a hex colour so neighbouring sectors of one category differ. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  // Rounded so server- and browser-computed SVG paths are identical (hydration).
  const p = (a: number) => [Math.round((cx + r * Math.sin(a)) * 100) / 100, Math.round((cy - r * Math.cos(a)) * 100) / 100];
  const [x0, y0] = p(a0); const [x1, y1] = p(a1);
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`;
}

// ------------------------------------------------------------------ audio --
class WheelAudio {
  ctx: AudioContext | null = null;
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    return this.ctx;
  }
  tick() {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "square"; o.frequency.value = 1400;
    g.gain.setValueAtTime(0.05, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05);
  }
  fanfare() {
    const ctx = this.ensure(); if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.65);
    });
  }
}

// --------------------------------------------------------------- confetti --
function launchConfetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const W = (canvas.width = canvas.offsetWidth * devicePixelRatio);
  const H = (canvas.height = canvas.offsetHeight * devicePixelRatio);
  const colors = ["#5a45cb", "#1ED760", "#0091FF", "#F59E0B", "#EF4444", "#8B5CF6"];
  const parts = Array.from({ length: 160 }, () => ({
    x: W / 2, y: H * 0.45, vx: (Math.random() - 0.5) * 18 * devicePixelRatio, vy: (-Math.random() * 16 - 4) * devicePixelRatio,
    s: (Math.random() * 6 + 4) * devicePixelRatio, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)]!,
  }));
  let frame = 0;
  const step = () => {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.45 * devicePixelRatio; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (++frame < 200) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
}

export function SpinWheel({ eventId, sectors: initialSectors, drawn, canSpin, accommodation }: {
  eventId: string | null; sectors: Sector[]; drawn: boolean; canSpin: boolean; accommodation: boolean;
}) {
  const router = useRouter();
  const [sectors, setSectors] = useState<Sector[]>(initialSectors);
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<"idle" | "requesting" | "spinning" | "done">("idle");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const audio = useRef<WheelAudio | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rotRef = useRef(0);

  const locked = useRef(false);
  // Server data refreshes (revalidation) must never replace the wheel mid-spin
  // or after the reveal.
  useEffect(() => { if (!locked.current) setSectors(initialSectors); }, [initialSectors]);
  useEffect(() => {
    // Sync with browser storage after mount (not available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setMuted(localStorage.getItem("wt:wheel-muted") === "1"); } catch { /* storage unavailable */ }
  }, []);

  const total = useMemo(() => sectors.reduce((s, x) => s + Number(x.weight), 0) || 1, [sectors]);
  const angles = useMemo(() => {
    const ends = sectors.map((_, i) => sectors.slice(0, i + 1).reduce((s, x) => s + Number(x.weight), 0));
    return sectors.map((s, i) => [((ends[i]! - Number(s.weight)) / total) * 2 * Math.PI, (ends[i]! / total) * 2 * Math.PI] as const);
  }, [sectors, total]);

  const indexAtPointer = useCallback((rotDeg: number) => {
    const a = (((-rotDeg % 360) + 360) % 360) * (Math.PI / 180);
    return angles.findIndex(([a0, a1]) => a >= a0 && a < a1);
  }, [angles]);

  function animateTo(index: number, secs: Sector[], res: SpinResult) {
    const localAngles = (() => { let acc = 0; const t = secs.reduce((s, x) => s + Number(x.weight), 0) || 1;
      return secs.map((s) => { const a0 = (acc / t) * 360; acc += Number(s.weight); return [a0, (acc / t) * 360] as const; }); })();
    const [a0, a1] = localAngles[index]!;
    const jitter = (Math.random() - 0.5) * (a1 - a0) * 0.6; // cosmetic only — the result is fixed
    const mid = (a0 + a1) / 2 + jitter;
    const start = rotRef.current;
    const base = start - (start % 360);
    const target = base + 360 * 6 + (360 - mid);
    const duration = 5600;
    const t0 = performance.now();
    let last = -1;
    audio.current ??= new WheelAudio();
    setPhase("spinning");
    const frame = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      const r = start + (target - start) * eased;
      rotRef.current = r;
      setRotation(r);
      const idx = indexAtPointer(r);
      if (idx !== last) { last = idx; if (!muted) audio.current?.tick(); }
      if (t < 1) requestAnimationFrame(frame);
      else {
        setPhase("done");
        setResult(res);
        if (!muted) audio.current?.fanfare();
        if (canvas.current) launchConfetti(canvas.current);
        router.refresh();
      }
    };
    requestAnimationFrame(frame);
  }

  async function spin() {
    if (!eventId || phase === "requesting" || phase === "spinning") return;
    setError(null);
    locked.current = true;
    setPhase("requesting");
    audio.current ??= new WheelAudio();
    audio.current.ensure(); // unlock audio on user gesture
    const res = await spinAccountability(eventId);
    if (!res.ok || res.winning_index === undefined || !res.sectors) {
      locked.current = false;
      setPhase("idle");
      setError(res.message ?? "The wheel could not be spun. Please try again.");
      return;
    }
    // Always animate over the exact pool the server drew from.
    const secs = res.sectors as Sector[];
    setSectors(secs);
    requestAnimationFrame(() => animateTo(res.winning_index!, secs, res));
  }

  const size = 360, c = size / 2, r = c - 10;
  const busy = phase === "requesting" || phase === "spinning";

  return (
    <div className="relative">
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent-emerald" />
          <span className="font-heading text-heading-md text-ink">Accountability Wheel</span>
          <span className="rounded-md bg-surface-container-low px-2 py-0.5 text-label-sm text-secondary">{sectors.length} sectors</span>
          {accommodation && <span className="rounded-md bg-accent-emerald/10 px-2 py-0.5 text-label-sm text-on-tertiary-container">Accommodation active</span>}
        </div>
        <button onClick={() => { const m = !muted; setMuted(m); try { localStorage.setItem("wt:wheel-muted", m ? "1" : "0"); } catch { /* ignore */ } }}
          className="rounded-lg border border-border-subtle p-1.5 text-muted-text hover:bg-surface-alt" aria-label={muted ? "Unmute wheel sounds" : "Mute wheel sounds"}>
          <Icon name={muted ? "volume_off" : "volume_up"} className="text-[18px]" />
        </button>
      </div>

      <div className="relative mx-auto mt-4 aspect-square w-full max-w-[380px]">
        {sectors.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-full border-2 border-dashed border-border-strong text-center text-body-md text-muted-text">No eligible options</div>
        ) : (
          <>
            <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full drop-shadow-md" role="img" aria-label="Accountability wheel">
              <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: "50% 50%" }}>
                {sectors.map((s, i) => {
                  const [a0, a1] = angles[i]!;
                  const sameCat = sectors.slice(0, i).filter((x) => x.category === s.category).length;
                  const fill = shade(CONSEQUENCE_COLOR[s.category], sameCat % 2 ? -0.18 : sameCat % 3 ? 0.15 : 0);
                  const mid = (a0 + a1) / 2;
                  const deg = Math.round(((mid * 180) / Math.PI) * 100) / 100;
                  const span = ((a1 - a0) * 180) / Math.PI;
                  return (
                    <g key={s.option_id + i}>
                      <path d={arcPath(c, c, r, a0, a1)} fill={fill} stroke="#fff" strokeWidth="2" />
                      {span > 9 && (
                        <text x={c} y={Math.round(c - r * 0.58)} fill="#fff" fontSize={span > 24 ? 13 : 10} fontWeight={700} textAnchor="middle"
                          transform={`rotate(${deg} ${c} ${c}) rotate(${deg > 180 ? 90 : -90} ${c} ${Math.round(c - r * 0.58)})`} style={{ fontFamily: "Inter, sans-serif" }}>
                          {sectorLabel(s.category, s.quantity)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              <circle cx={c} cy={c} r={36} fill="#080808" stroke="#fff" strokeWidth="4" />
              <text x={c} y={c + 5} textAnchor="middle" fill="#1ED760" fontSize="14" fontWeight="800" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>WIN</text>
            </svg>
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1" aria-hidden>
              <svg width="28" height="34" viewBox="0 0 28 34"><path d="M14 34 L2 6 a12 12 0 1 1 24 0 Z" fill="#080808" /><circle cx="14" cy="12" r="5" fill="#1ED760" /></svg>
            </div>
          </>
        )}
      </div>

      <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-surface-alt p-4 sm:flex-row sm:justify-between">
        <div className="text-center text-body-sm text-muted-text sm:text-left">
          {phase === "done" && result ? <span className="font-semibold text-ink">Outcome recorded and assigned.</span>
            : busy ? "Selecting and recording your outcome on the server…"
            : drawn ? "Your outcome was selected automatically. Reveal it below."
            : canSpin ? "The server selects your outcome securely when you spin. Results are final — no re-spins."
            : "No spin is due right now."}
        </div>
        {(canSpin || busy) && phase !== "done" && (
          <button onClick={spin} disabled={busy} className="flex items-center gap-2 rounded-lg bg-on-tertiary-container px-6 py-3 font-heading text-body-lg font-bold text-white shadow-card hover:bg-on-tertiary-fixed-variant disabled:opacity-60">
            <Icon name={busy ? "progress_activity" : "cyclone"} className={cn(busy && "animate-spin")} />
            {phase === "requesting" ? "Selecting…" : phase === "spinning" ? "Spinning…" : drawn ? "REVEAL OUTCOME" : "SPIN WHEEL NOW"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">{error}</p>}
      {phase === "done" && result?.category && (
        <div role="status" className="mt-4 flex animate-fade-in items-center gap-3 rounded-xl border-2 p-4" style={{ borderColor: CONSEQUENCE_COLOR[result.category as Sector["category"]] }}>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ background: CONSEQUENCE_COLOR[result.category as Sector["category"]] }}>
            <Icon name={CONSEQUENCE_ICON[result.category as Sector["category"]]} />
          </span>
          <div>
            <div className="eyebrow">Assigned to you · active now</div>
            <div className="font-heading text-heading-md text-ink">{consequenceText(result.category as Sector["category"], result.quantity!)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
