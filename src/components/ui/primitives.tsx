"use client";

import React, { useEffect, useId, useRef } from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";

export type NavTab =
  | "overview"
  | "markets"
  | "analyst"
  | "signals"
  | "modflow"
  | "liquidity"
  | "strategies"
  | "backtesting"
  | "risk"
  | "calendar"
  | "journal"
  | "analytics"
  | "alerts"
  | "automation"
  | "settings";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatPrice(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCurrency(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(value: number | null | undefined, decimals = 2, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatDateTime(
  input: string | number | Date | null | undefined,
  timezone = "UTC",
  opts?: { timeOnly?: boolean; short?: boolean }
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    const tz = timezone === "LOCAL" ? undefined : timezone;
    if (opts?.timeOnly)
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    if (opts?.short)
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function formatTimeAgo(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "Just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) {
    const ago = Math.abs(diff);
    const mins = Math.floor(ago / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, "0")}m`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatClock(input: string | number, timezone = "UTC"): string {
  return formatDateTime(input, timezone, { timeOnly: true });
}

export function formatDayHeading(input: string | number, timezone = "UTC"): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone === "LOCAL" ? undefined : timezone,
      weekday: "long",
      day: "2-digit",
      month: "short",
    })
      .format(d)
      .replaceAll(",", "")
      .toUpperCase();
  } catch {
    return new Date(input).toISOString().slice(0, 10).toUpperCase();
  }
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

/* Panels and layout primitives — compact sizing */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  noPadding,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}) {
  return (
    <section className={cn("freyr-panel overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-ink/[0.06] px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[12.5px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-ink-secondary">{subtitle}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={cn(!noPadding && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHero({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h1 className="freyr-page-title min-w-0">{title}</h1>
        {(actions || icon) && <div className="flex shrink-0 items-center gap-1">
          {actions}
          {icon && <span className="grid size-8 place-items-center rounded-full border border-outline bg-inset text-ink-secondary">{icon}</span>}
        </div>}
      </div>
      {description && <p className="freyr-page-description">{description}</p>}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("freyr-eyebrow", className)}>{children}</div>;
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "accent" | "bull" | "bear" | "neutral";
  className?: string;
}) {
  const tones: Record<string, string> = {
    accent: "border-outline bg-elevated text-ink",
    bull: "border-bull/35 bg-bull/10 text-bull",
    bear: "border-bear/40 bg-bear/10 text-bear",
    neutral: "border-ink/[0.12] bg-ink/[0.04] text-ink-secondary",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function formatDataStatus(status: string) {
  const labels: Record<string, string> = { LIVE: "Synced", CACHED: "Cached", DELAYED: "Delayed", UNAVAILABLE: "Unavailable", SIMULATED: "Simulated", MANUAL: "Manual", HISTORICAL: "Historical" };
  return labels[status?.toUpperCase()] ?? "Unavailable";
}

export function cleanCopy(text: string) {
  return text.replace(/\b(?:real[\s\-–]+time|live)\b/gi, "synced").replace(/(Signal|signal)\s+#\d+/g, "$1");
}

export function DataStatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const upper = status.toUpperCase();
  const map: Record<string, { dot: string; text: string; bg: string; textLabel: string }> = {
    LIVE: { dot: "bg-bull freyr-status-dot", text: "text-bull", bg: "bg-elevated border-outline", textLabel: "Synced" },
    DELAYED: { dot: "bg-ink-tertiary", text: "text-ink-secondary", bg: "bg-elevated border-outline", textLabel: "Delayed" },
    CACHED: { dot: "bg-ink-tertiary", text: "text-ink-secondary", bg: "bg-elevated border-outline", textLabel: "Cached" },
    SIMULATED: { dot: "bg-ink-tertiary", text: "text-ink-secondary", bg: "bg-elevated border-outline", textLabel: "Simulated" },
    UNAVAILABLE: { dot: "bg-bear", text: "text-bear", bg: "bg-bear/[0.1] border-bear/25", textLabel: "Unavailable" },
  };
  const cfg = map[upper] ?? (upper === "MANUAL" || upper === "HISTORICAL" ? map.CACHED : map.UNAVAILABLE);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-[2px] text-[9.5px] font-semibold tracking-[0.035em] uppercase", cfg.bg, cfg.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {label ? cleanCopy(label) : formatDataStatus(status)}
    </span>
  );
}

export function DirectionBadge({ direction, className }: { direction: string; className?: string }) {
  const up = direction.toUpperCase();
  const isBull = up === "BULLISH" || up === "BUY" || up === "WIN" || up === "VALID" || up === "LONG";
  const isBear = up === "BEARISH" || up === "SELL" || up === "LOSS" || up === "INVALID" || up === "SHORT";
  const isWait = up === "WAIT" || up === "NEUTRAL" || up === "RANGING" || up === "WATCHLIST";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.045em] uppercase whitespace-nowrap",
        isBull
          ? "border-bull/45 bg-bull/[0.07] text-bull"
          : isBear
            ? "border-bear/45 bg-bear/[0.07] text-bear"
            : isWait
              ? "border-ink/[0.14] bg-ink/[0.04] text-ink-secondary"
              : "border-outline bg-elevated text-ink-secondary",
        className
      )}
    >
      <span aria-hidden="true">{isBull ? "↗" : isBear ? "↘" : "—"}</span>
      {direction.replace(/_/g, " ")}
    </span>
  );
}

export function SignalStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; dot: string; label: string }> = {
    ACTIVE: { cls: "border-ink/[0.14] bg-ink/[0.05] text-ink", dot: "freyr-selection-dot", label: "Active" },
    PENDING: { cls: "border-ink/[0.12] bg-ink/[0.03] text-ink-secondary", dot: "bg-ink-tertiary", label: "Pending" },
    TP1_REACHED: { cls: "border-bull/35 bg-bull/10 text-bull", dot: "bg-bull", label: "Partial milestone" },
    TP2_REACHED: { cls: "border-bull/40 bg-bull/12 text-bull", dot: "bg-bull", label: "Take profit reached" },
    TP_HIT: { cls: "border-bull/40 bg-bull/12 text-bull", dot: "bg-bull", label: "Take profit reached" },
    SL_HIT: { cls: "border-bear/35 bg-bear/10 text-bear", dot: "bg-bear", label: "Stopped" },
    INVALIDATED: { cls: "border-bear/25 bg-bear/[0.07] text-bear", dot: "bg-bear", label: "Invalidated" },
    EXPIRED: { cls: "border-ink/[0.1] bg-ink/[0.03] text-ink-secondary", dot: "bg-ink-tertiary", label: "Expired" },
  };
  const cfg = map[status] ?? map.PENDING;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold whitespace-nowrap", cfg.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md";
}) {
  const v: Record<string, string> = {
    primary: "freyr-hover-outline bg-inset text-ink border border-[var(--freyr-control)] hover:bg-hover font-semibold",
    gold: "freyr-hover-outline bg-inset text-ink border border-outline hover:bg-hover font-semibold",
    secondary: "freyr-hover-outline bg-elevated text-ink border border-outline hover:bg-hover font-medium",
    ghost: "freyr-hover-outline bg-transparent text-ink-secondary border border-transparent hover:bg-hover hover:text-ink",
    danger: "bg-bear/[0.12] text-bear border border-bear/30 hover:bg-bear/20 font-semibold",
  };
  const s = size === "sm" ? "min-h-9 px-3 text-[12px] rounded-full" : "min-h-10 px-4 text-[13px] rounded-full";
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap",
        v[variant],
        s,
        className
      )}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, size = "sm", ariaLabel }: {
  options: Array<{ value: T; label: React.ReactNode }>; value: T; onChange: (value: T) => void; size?: "xs" | "sm"; ariaLabel?: string;
}) {
  function move(event: React.KeyboardEvent<HTMLDivElement>) {
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const current = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % controls.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + controls.length) % controls.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = controls.length - 1;
    else return;
    event.preventDefault();
    controls[next]?.focus();
    onChange(options[next].value);
  }
  return <div className="freyr-segments" role="tablist" aria-label={ariaLabel ?? "View"} onKeyDown={move}>
    {options.map((opt) => <button className={cn("freyr-segment", size === "xs" && "freyr-segment-small")} key={opt.value} type="button" role="tab" aria-selected={opt.value === value} tabIndex={opt.value === value ? 0 : -1} onClick={() => onChange(opt.value)}>{opt.label}</button>)}
  </div>;
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="freyr-switch relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="freyr-switch-knob" aria-hidden="true" />
    </button>
  );
}

export function KpiStat({
  label,
  value,
  sub,
  tone = "neutral",
  compact,
  featured,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "bull" | "bear" | "gold" | "accent";
  compact?: boolean;
  featured?: boolean;
}) {
  const color =
    tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink";
  return (
    <div className={cn("freyr-card flex min-w-0 flex-col items-center justify-center text-center", featured ? "min-h-[73px] px-1.5 py-2.5 sm:min-h-[91px]" : compact ? "px-2 py-2.5" : "px-2.5 py-3.5")}>
      <div className={cn("font-semibold tracking-[-0.03em] tabular-nums", featured ? "text-[clamp(17px,5.6vw,27px)] leading-tight tracking-[-0.04em]" : compact ? "text-[16px]" : "text-[22px]", color)}>
        {value}
      </div>
      <div className={cn("mt-1 text-[9.5px] font-semibold leading-tight tracking-[0.075em] text-ink-secondary uppercase", featured && "sm:mt-1.5 sm:text-[10.5px]")}>{label}</div>
      {sub && <div className="mt-0.5 max-w-full truncate text-[10px] text-ink-tertiary">{sub}</div>}
    </div>
  );
}

export function PanelSkeleton({ rows = 4, height }: { rows?: number; height?: string }) {
  return (
    <div className={cn("freyr-panel freyr-skeleton p-4", height)} aria-hidden="true">
      <div className="h-3.5 w-32 rounded-lg bg-ink/[0.07]" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-2.5 rounded-md bg-ink/[0.04]" style={{ width: `${92 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-2 rounded-2xl border border-bear/25 bg-bear/[0.07] px-3.5 py-2.5 text-[12px] text-bear">
      <div className="flex min-w-0 items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-bear" strokeWidth={1.7} />
        <span className="break-words">{cleanCopy(message)}</span>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-ink/[0.1] px-5 py-9 text-center">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-secondary">{description}</p>
      {action && <div className="mt-3.5">{action}</div>}
    </div>
  );
}

export function ModalSheet({ open, onClose, title, subtitle, children, maxWidth = "max-w-lg" }: {
  open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; maxWidth?: string;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return <dialog ref={panel} className={cn("freyr-dialog liquid-glass", maxWidth)} aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="freyr-dialog-inner">
      <header className="flex items-start justify-between gap-3 border-b border-ink/[0.08] px-4 py-3.5 sm:px-5">
        <div className="min-w-0"><h2 id={heading} className="text-[18px] font-semibold tracking-tight text-ink">{title}</h2>{subtitle && <p className="mt-0.5 text-[12px] text-ink-secondary">{subtitle}</p>}</div>
        <button type="button" autoFocus aria-label="Close dialog" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-secondary hover:bg-ink/8 hover:text-ink"><X size={17} aria-hidden="true" /></button>
      </header>
      <div className="min-h-0 overflow-y-auto bg-surface p-4 sm:p-5">{children}</div>
    </div>
  </dialog>;
}

export const INPUT_CLS = "freyr-input";
export const LABEL_CLS = "freyr-label";
