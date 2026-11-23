import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Icon({ name, className, fill }: { name: string; className?: string; fill?: boolean }) {
  return <span aria-hidden className={cn("material-symbols-outlined shrink-0", fill && "icon-fill", className)}>{name}</span>;
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return <section className={cn("card", className)} {...rest}>{children}</section>;
}

export function CardHeader({ eyebrow, title, action, icon, className }: { eyebrow?: string; title: ReactNode; action?: ReactNode; icon?: string; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-container-low text-secondary"><Icon name={icon} /></span>}
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="font-heading text-heading-md text-ink">{title}</h2>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const BTN = {
  primary: "bg-primary text-on-primary hover:bg-primary-container",
  secondary: "bg-secondary text-on-secondary hover:bg-on-secondary-fixed-variant",
  success: "bg-on-tertiary-container text-white hover:bg-on-tertiary-fixed-variant",
  outline: "border border-border-subtle bg-surface text-body-text hover:bg-surface-alt",
  ghost: "text-muted-text hover:bg-surface-alt hover:text-ink",
  danger: "bg-accent-red text-white hover:bg-error",
} as const;
export type ButtonVariant = keyof typeof BTN;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-body-sm" : "px-3.5 py-2 text-label-md",
    BTN[variant],
  );
}

export function Button({ variant = "primary", size = "md", className, icon, children, ...rest }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: string }) {
  return (
    <button className={cn(buttonClass(variant, size), className)} {...rest}>
      {icon && <Icon name={icon} className="text-[18px]" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", className, icon, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: string }) {
  return (
    <Link className={cn(buttonClass(variant, size), className)} {...rest}>
      {icon && <Icon name={icon} className="text-[18px]" />}
      {children}
    </Link>
  );
}

const BADGE = {
  neutral: "bg-surface-alt text-muted-text",
  purple: "bg-surface-container-low text-secondary",
  green: "bg-accent-emerald/10 text-on-tertiary-container",
  amber: "bg-accent-amber/10 text-warning-text",
  red: "bg-accent-red/10 text-accent-red",
  blue: "bg-accent-blue/10 text-accent-blue",
  dark: "bg-primary text-on-primary",
} as const;
export function Badge({ tone = "neutral", className, children, dot }: { tone?: keyof typeof BADGE; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-label-sm whitespace-nowrap", BADGE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Progress({ value, color = "var(--color-secondary)", className, label }: { value: number | null | undefined; color?: string; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-alt", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function scoreColor(v: number | null | undefined) {
  if (v === null || v === undefined) return "var(--color-faint-text)";
  return v >= 90 ? "var(--color-accent-emerald)" : v >= 75 ? "var(--color-accent-blue)" : v >= 50 ? "var(--color-accent-amber)" : "var(--color-accent-red)";
}

export function RingGauge({ value, size = 160, stroke = 12, label, sub }: { value: number | null; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-alt)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(value)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} className="transition-all duration-700" />
      </svg>
      <div className="absolute text-center">
        <div className="font-heading text-[30px] font-bold leading-none tracking-tight text-ink">{value === null ? "—" : `${Number(value).toFixed(1).replace(/\.0$/, "")}%`}</div>
        {label && <div className="mt-1 text-label-sm uppercase tracking-wider text-muted-text">{label}</div>}
        {sub && <div className="text-body-sm text-on-tertiary-container">{sub}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 eyebrow">{eyebrow}</div>}
        <h1 className="font-heading text-display-lg-mobile text-ink md:text-display-lg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-body-md text-muted-text">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-alt/40 px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-secondary shadow-card"><Icon name={icon} /></span>
      <div className="font-heading text-body-lg text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-body-md text-muted-text">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, icon, tone = "purple", href }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string; tone?: keyof typeof BADGE; href?: string }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {icon && <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", BADGE[tone])}><Icon name={icon} className="text-[18px]" /></span>}
      </div>
      <div className="mt-2 font-heading text-[28px] font-bold leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-2 text-body-sm text-muted-text">{sub}</div>}
    </>
  );
  return href
    ? <Link href={href} className="card block p-4 transition-shadow hover:shadow-float">{inner}</Link>
    : <div className="card p-4">{inner}</div>;
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const init = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
  ) : (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-heading font-bold text-on-secondary", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }} aria-label={name}>{init || "?"}</span>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-body-sm text-faint-text">{hint}</span>}
    </label>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-body-md">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("border-b border-border-subtle bg-surface-alt/60 px-4 py-2.5 text-label-sm uppercase tracking-wider text-muted-text", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("border-b border-border-subtle px-4 py-3 align-middle", className)}>{children}</td>;
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string; icon?: string }[]; active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border-subtle scrollbar-none" aria-label="Sections">
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}
          className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-label-md transition-colors",
            t.key === active ? "border-secondary text-secondary" : "border-transparent text-muted-text hover:text-ink")}>
          {t.icon && <Icon name={t.icon} className="text-[18px]" />}{t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-body-sm text-muted-text">
      <span>Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link className={buttonClass("outline", "sm")} href={hrefFor(page - 1)}>Previous</Link> : <span className={cn(buttonClass("outline", "sm"), "opacity-40")}>Previous</span>}
        <span className="px-2">Page {page} / {pages}</span>
        {page < pages ? <Link className={buttonClass("outline", "sm")} href={hrefFor(page + 1)}>Next</Link> : <span className={cn(buttonClass("outline", "sm"), "opacity-40")}>Next</span>}
      </div>
    </div>
  );
}

/** Small inline SVG sparkline/bar chart (no chart library needed). */
export function BarChart({ data, height = 140, max = 100, color = "var(--color-secondary)" }: { data: { label: string; value: number | null }[]; height?: number; max?: number; color?: string }) {
  if (data.length === 0) return null;
  const w = 100 / data.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Chart">
        {[25, 50, 75].map((g) => <line key={g} x1="0" x2="100" y1={height - (g / max) * height} y2={height - (g / max) * height} stroke="var(--color-border-subtle)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const h = d.value === null ? 0 : (Math.min(d.value, max) / max) * (height - 4);
          return <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={height - h} height={h} rx="1" fill={d.value === null ? "var(--color-surface-alt)" : color}><title>{`${d.label}: ${d.value === null ? "n/a" : d.value + "%"}`}</title></rect>;
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-faint-text">
        {data.map((d, i) => <span key={i} className="truncate text-center" style={{ width: `${w}%` }}>{d.label}</span>)}
      </div>
    </div>
  );
}
