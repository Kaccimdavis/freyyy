"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  FileText,
  KeyRound,
  LifeBuoy,
  LogOut,
  Monitor,
  Pencil,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { BrokerConfig, ChartPreferences, NotificationPreferences } from "@/db/schema";
import type { AppearanceMode } from "@/db/schema";
import type { FeedHealthRecord, Timeframe } from "@/lib/market-data";
import {
  Button,
  Chip,
  DataStatusBadge,
  ErrorBanner,
  INPUT_CLS,
  LABEL_CLS,
  PageHero,
  PanelSkeleton,
  SectionLabel,
  SegmentedControl,
  Switch,
  cn,
} from "@/components/ui/primitives";

interface SettingsPayload {
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
    timezone: string;
    defaultSymbol: string;
    defaultTimeframe: Timeframe;
    subscriptionTier: string;
    chartPrefs: ChartPreferences;
    brokerConfig: BrokerConfig;
    notificationPrefs: NotificationPreferences;
    appearance: AppearanceMode;
  };
  isAuthenticated: boolean;
  feeds: FeedHealthRecord[];
}

const TIMEZONES = [
  "UTC",
  "Africa/Kampala",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Zurich",
  "Europe/Frankfurt",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function Row({
  icon,
  title,
  subtitle,
  onClick,
  trailing,
  children,
  expanded,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  expanded?: boolean;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary ring-1 ring-outline">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-[10.5px] text-ink-secondary">{subtitle}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {trailing}
        {(onClick || href) && <ChevronDown className={cn("h-4 w-4 text-ink-tertiary", expanded && "rotate-180", !onClick && "-rotate-90")} />}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="freyr-row block overflow-hidden">
        {inner}
      </Link>
    );
  }

  return (
    <div className="freyr-row overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left"
        aria-expanded={expanded}
      >
        {inner}
      </button>
      {expanded && children && <div className="border-t border-ink/[0.07] px-3.5 py-3.5">{children}</div>}
    </div>
  );
}

export function SettingsView({
  appearance,
  navigation,
  onAppearanceChange,
  onPrefsChanged,
}: {
  appearance: AppearanceMode;
  navigation?: React.ReactNode;
  onAppearanceChange: (mode: AppearanceMode) => void;
  onPrefsChanged: (patch: {
    timezone?: string;
    defaultSymbol?: string;
    defaultTimeframe?: Timeframe;
    hollowCandles?: boolean;
    userName?: string;
  }) => void;
}) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [defaultSymbol, setDefaultSymbol] = useState("XAUUSD");
  const [defaultTimeframe, setDefaultTimeframe] = useState<Timeframe>("15m");
  const [chartPrefs, setChartPrefs] = useState<ChartPreferences | null>(null);
  const [broker, setBroker] = useState<BrokerConfig | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [prefBusy, setPrefBusy] = useState(false);
  const [avatar, setAvatar] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setAvatar(window.localStorage.getItem("freyr-profile-avatar") ?? ""); } catch { /* storage unavailable */ }
  }, []);

  const handleAvatar = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { setErr("Profile images must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      try { window.localStorage.setItem("freyr-profile-avatar", value); setAvatar(value); setMsg("Profile picture updated."); }
      catch { setErr("Couldn’t save this image. Choose a smaller image."); }
    };
    reader.readAsDataURL(file);
  };

  const [authMode, setAuthMode] = useState<"password" | "login" | "register">("password");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPw, setAuthPw] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: SettingsPayload = await res.json();
      setData(j);
      setName(j.user.name);
      setTimezone(j.user.timezone);
      setDefaultSymbol(j.user.defaultSymbol);
      setDefaultTimeframe(j.user.defaultTimeframe);
      setChartPrefs(j.user.chartPrefs);
      setBroker(j.user.brokerConfig);
      setPrefs({ ...j.user.notificationPrefs, promos: j.user.notificationPrefs?.promos ?? false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, successText: string) => {
    setErr(null); setMsg(null);
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn’t save changes.");
      setData((previous) => previous ? { ...previous, user: result.user, feeds: result.feeds ?? previous.feeds } : previous);
      setMsg(successText);
      if (result.user) onPrefsChanged({ timezone: result.user.timezone, defaultSymbol: result.user.defaultSymbol, defaultTimeframe: result.user.defaultTimeframe, hollowCandles: result.user.chartPrefs?.candleStyle === "hollow", userName: result.user.name });
      return true;
    } catch (error) { setErr(error instanceof Error ? error.message : "Couldn’t save changes."); return false; }
  };

  const handleAppearance = async (mode: AppearanceMode) => {
    if (await patch({ appearance: mode }, mode === "system" ? "Appearance follows your device." : "Appearance saved.")) onAppearanceChange(mode);
  };

  const togglePref = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!prefs || prefBusy) return;
    setPrefBusy(true); setErr(null);
    try {
      if (key === "browserEnabled" && value) {
        if (!("Notification" in window)) { setErr("This browser does not support notifications. In-app alerts are still available."); return; }
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") { setErr("Allow notifications for Freyr in your browser settings to turn them on."); return; }
      }
      const next = { ...prefs, [key]: value };
      if (await patch({ notificationPrefs: next }, "Notification preferences saved.")) setPrefs(next);
    } catch { setErr("Couldn’t update notification permissions."); }
    finally { setPrefBusy(false); }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const body =
      authMode === "password"
        ? { action: "change_password", currentPassword: curPw, newPassword: newPw }
        : authMode === "login"
          ? { action: "login", email: authEmail, password: authPw }
          : { action: "register", name: authName, email: authEmail, password: authPw };
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) {
      setErr(j.error || "Authentication failed");
      return;
    }
    setCurPw("");
    setNewPw("");
    setAuthPw("");
    setMsg(
      authMode === "password"
        ? "Password updated."
        : authMode === "login"
          ? `Signed in as ${j.user.email}.`
          : `Account created as ${j.user.email}.`
    );
    if (authMode === "password") await load();
    else window.location.reload();
  };

  const handleLogout = async () => {
    setErr(null);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
      if (!response.ok) throw new Error("Couldn’t sign out. Try again.");
      window.location.replace("/#settings");
      window.location.reload();
    } catch (error) { setErr(error instanceof Error ? error.message : "Couldn’t sign out."); }
  };

  if (!loading && !data && err) return <ErrorBanner message={err} onRetry={load} />;
  if (loading || !data) {
    return (
      <div className="mx-auto w-full max-w-[560px] space-y-3">
        <PanelSkeleton rows={2} />
        <PanelSkeleton rows={6} />
      </div>
    );
  }

  const initials = data.user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const footprintRows: Array<[keyof NonNullable<ChartPreferences["footprintConfluences"]>, string, string]> = [
    ["deltaFlip", "Delta Flip", "Detect a sign reversal in estimated delta with matching price response."],
    ["deltaSurge", "Delta Surge", "Detect expanding same-side estimated delta across three bars."],
    ["deltaTransition", "Delta Transition", "Detect weakening prior pressure followed by opposing pressure."],
    ["deltaAbsorption", "Delta Absorption", "Detect high-volume candle rejection patterns that may indicate absorption."],
    ["cumulativeDelta", "Cumulative Delta", "Require estimated cumulative delta to agree with recent price direction."],
  ];

  const legalRows = [
    { icon: <BookOpen size={16} />, title: "About Freyr", subtitle: "The app, its data sources and operator", href: "/legal/about" },
    { icon: <LifeBuoy className="h-4 w-4" />, title: "Help & support", subtitle: "Answers, contact and workspace help", href: "/help" },
    { icon: <Scale className="h-4 w-4" />, title: "Risk disclaimer", subtitle: "Trading involves substantial risk of loss", href: "/legal/risk" },
    { icon: <FileText className="h-4 w-4" />, title: "Terms of use", subtitle: "The agreement governing this service", href: "/legal/terms" },
    { icon: <ShieldCheck className="h-4 w-4" />, title: "Privacy policy", subtitle: "What we collect and why", href: "/legal/privacy" },
    { icon: <Receipt className="h-4 w-4" />, title: "Refund policy", subtitle: "When and where to request a refund", href: "/legal/refund" },
  ];

  return (
    <div className="freyr-primary-view">
      <PageHero title="Settings" description="Profile, security, preferences and legal." actions={navigation} />

      {msg && <div className="rounded-2xl border border-bull/25 bg-bull/[0.08] px-3.5 py-2 text-[11.5px] text-bull">{msg}</div>}
      {err && <ErrorBanner message={err} />}

      {/* Profile card */}
      <section className="freyr-panel p-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => avatarInput.current?.click()} className="group relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-outline bg-inset text-[18px] font-semibold text-ink-secondary" aria-label="Change profile picture">{avatar ? <img src={avatar} alt="Profile" className="size-full object-cover" /> : initials || "F"}<span className="absolute inset-0 grid place-items-center bg-black/55 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">EDIT</span></button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatar(e.target.files?.[0])} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-ink">{data.user.name}</div>
            <div className="truncate text-[11.5px] text-ink-secondary">{data.user.email}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Chip tone="neutral">{data.isAuthenticated ? "Signed in" : "Desk workspace"}</Chip>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Button variant="secondary" size="sm" className="w-full" onClick={() => { setAuthMode(data.isAuthenticated ? "password" : "login"); setOpen(open === "edit" ? null : "edit"); }}>
            <Pencil className="h-3.5 w-3.5" /> Edit details & password
          </Button>
        </div>
        {open === "edit" && (
          <div className="mt-3 space-y-2 border-t border-ink/[0.07] pt-3">
            <div>
              <label className={LABEL_CLS}>Display name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className={LABEL_CLS}>Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={INPUT_CLS}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Market</label>
                <select value={defaultSymbol} onChange={(e) => setDefaultSymbol(e.target.value)} className={INPUT_CLS}>
                  {["XAUUSD", "BTCUSD", "ETHUSD", "EURUSD", "GBPUSD", "US500", "NAS100"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Timeframe</label>
                <select value={defaultTimeframe} onChange={(e) => setDefaultTimeframe(e.target.value as Timeframe)} className={INPUT_CLS}>
                  {["3m", "5m", "15m", "1h", "4h", "1d"].map((t) => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
                  if (local) setTimezone(local);
                }}
                className="text-[10.5px] text-ink-secondary hover:underline cursor-pointer"
              >
                Use device timezone
              </button>
              <Button variant="primary" size="sm" onClick={() => patch({ name, timezone, defaultSymbol, defaultTimeframe }, "Profile updated.")}>
                Save
              </Button>
            </div>
          </div>
        )}
        {open === "edit" && (
          <div className="mt-3 border-t border-ink/[0.07] pt-3">
            <SegmentedControl
              options={[
                ...(data.isAuthenticated ? [{ value: "password" as const, label: "Password" }] : []),
                { value: "login", label: "Sign in" },
                { value: "register", label: "Create" },
              ]}
              value={authMode}
              onChange={setAuthMode}
              size="xs"
              ariaLabel="Authentication mode"
            />
            <form onSubmit={handleAuth} className="mt-2.5 space-y-2">
              {authMode === "password" ? (
                <>
                  <div>
                    <label className={LABEL_CLS}>Current password</label>
                    <input required type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>New password</label>
                    <input required minLength={8} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className={INPUT_CLS} />
                  </div>
                </>
              ) : (
                <>
                  {authMode === "register" && (
                    <div>
                      <label className={LABEL_CLS}>Full name</label>
                      <input required value={authName} onChange={(e) => setAuthName(e.target.value)} className={INPUT_CLS} />
                    </div>
                  )}
                  <div>
                    <label className={LABEL_CLS}>Email</label>
                    <input required type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Password</label>
                    <input required minLength={8} type="password" value={authPw} onChange={(e) => setAuthPw(e.target.value)} className={INPUT_CLS} />
                  </div>
                </>
              )}
              <Button type="submit" variant="primary" size="sm">
                {authMode === "password" ? "Update password" : authMode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </div>
        )}
      </section>

      {/* Appearance */}
      <div className="space-y-1.5">
        <SectionLabel className="px-1">Appearance</SectionLabel>
        <div className="freyr-row flex items-center justify-between gap-2 px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-inset text-ink-secondary ring-1 ring-outline">
              <Monitor className="h-4 w-4" />
            </span>
            <span className="text-[12px] font-semibold text-ink">Theme</span>
          </div>
          <SegmentedControl
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={appearance}
            onChange={handleAppearance}
            size="xs"
            ariaLabel="Appearance"
          />
        </div>
      </div>

      {/* Notifications */}
      <div className="space-y-1.5">
        <SectionLabel className="px-1">Notifications</SectionLabel>
        <div className="freyr-row divide-y divide-ink/[0.06]">
          {prefs && (
            <>
              {(
                [
                  ["browserEnabled", "Browser notifications", "Desktop alerts while Freyr is open"],
                  ["newSignals", "New signal published", "When the engine releases a call"],
                  ["entryZone", "Entry zone tapped", "When price trades into the published zone"],
                  ["slTpHits", "Targets and stops", "Milestones, targets, stops and expiry"],
                  ["economicEvents", "High-impact releases", "Gold-sensitive calendar alerts"],
                  ["liquiditySweeps", "Liquidity sweeps", "Stop hunts and pool clears on gold"],
                ] as Array<[keyof NotificationPreferences, string, string]>
              ).map(([key, title, sub]) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-ink">{title}</div>
                    <div className="text-[10px] text-ink-secondary">{sub}</div>
                  </div>
                  <Switch checked={Boolean(prefs[key])} disabled={prefBusy} onChange={(v) => togglePref(key, v)} label={title} />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-ink">Product updates & offers</div>
                  <div className="text-[10px] text-ink-secondary">Occasional news — unsubscribe anytime</div>
                </div>
                <Switch checked={Boolean(prefs.promos)} disabled={prefBusy} onChange={(v) => togglePref("promos", v)} label="Promotions" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footprint intelligence */}
      {chartPrefs && (
        <div className="space-y-1.5">
          <SectionLabel className="px-1">Footprint intelligence</SectionLabel>
          <div className="freyr-row divide-y divide-ink/[0.06]">
            {footprintRows.map(([key, title, description]) => (
              <div key={key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-ink">{title}</div>
                  <div className="text-[10px] text-ink-secondary">{description}</div>
                </div>
                <Switch
                  checked={Boolean(chartPrefs.footprintConfluences?.[key])}
                  onChange={(value) => {
                    const next: ChartPreferences = {
                      ...chartPrefs,
                      footprintConfluences: {
                        deltaFlip: false,
                        deltaSurge: false,
                        deltaTransition: false,
                        deltaAbsorption: false,
                        cumulativeDelta: false,
                        ...(chartPrefs.footprintConfluences ?? {}),
                        [key]: value,
                      },
                    };
                    setChartPrefs(next);
                    patch({ chartPrefs: next }, "Footprint confluence settings saved.");
                  }}
                  label={title}
                />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[10px] leading-relaxed text-ink-secondary">
            Current feed limitation: these readings are derived from candle OHLCV estimates, not exchange-classified bid/ask trade prints. They are proxy confluences, not verified footprint delta. All five controls are off by default.
          </div>
        </div>
      )}

      {/* Chart preferences */}
      {chartPrefs && (
        <div className="space-y-1.5">
          <SectionLabel className="px-1">Charts</SectionLabel>
          <div className="freyr-row divide-y divide-ink/[0.06]">
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="text-[12px] font-semibold text-ink">Hollow candles</div>
              <Switch
                checked={chartPrefs.candleStyle === "hollow"}
                onChange={(v) => {
                  const next: ChartPreferences = { ...chartPrefs, candleStyle: v ? "hollow" : "candles" };
                  setChartPrefs(next);
                  patch({ chartPrefs: next }, "Chart style saved.");
                }}
                label="Hollow candles"
              />
            </div>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="text-[12px] font-semibold text-ink">Volume and EMA overlays</div>
              <Switch
                checked={Boolean(chartPrefs.showVolume)}
                onChange={(v) => {
                  const next: ChartPreferences = { ...chartPrefs, showVolume: v, showEma: v };
                  setChartPrefs(next);
                  patch({ chartPrefs: next }, "Chart overlays saved.");
                }}
                label="Volume and EMA overlays"
              />
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
              onClick={() => patch({ flushCache: true }, "Market cache cleared.")}
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw className="h-3.5 w-3.5 text-ink-secondary" />
                <div className="text-[12px] font-semibold text-ink">Refresh market cache</div>
              </div>
              <span className="text-[10.5px] text-ink-secondary">{data.feeds.filter((f) => f.status === "LIVE").length} of {data.feeds.length} feeds responding</span>
            </button>
          </div>
        </div>
      )}

      {/* Legal & support */}
      <div className="space-y-1.5">
        <SectionLabel className="px-1">Legal & support</SectionLabel>
        <div className="space-y-1.5">
          {legalRows.map((row) => (
            <Row key={row.href} {...row} href={row.href} />
          ))}
        </div>
      </div>

      {/* Services */}
      {broker && (
        <div className="space-y-1.5">
          <SectionLabel className="px-1">Services</SectionLabel>
          <Row
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title="Execution broker"
            subtitle={broker.connected ? `${broker.provider} · ${broker.environment === "demo" ? "Demo" : "Real"}` : "Manual only"}
            onClick={() => setOpen(open === "broker" ? null : "broker")}
            expanded={open === "broker"}
            trailing={<Chip tone={broker.connected ? "accent" : "neutral"}>{broker.connected ? "Configured" : "Off"}</Chip>}
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL_CLS}>Adapter</label>
                  <select
                    value={broker.provider}
                    onChange={(e) =>
                      setBroker({
                        ...broker,
                        provider: e.target.value,
                        connected: e.target.value !== "Manual only",
                        verified: false,
                        authorizedForAuto: false,
                      })
                    }
                    className={INPUT_CLS}
                  >
                    <option value="Manual only">Manual only</option>
                    <option value="Hyperliquid Perps API">Hyperliquid Perps</option>
                    <option value="OANDA v20 REST">OANDA v20</option>
                    <option value="MetaTrader 5 Bridge">MT5 bridge</option>
                    <option value="Interactive Brokers Gateway">Interactive Brokers</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Environment</label>
                  <select value={broker.environment} onChange={(e) => setBroker({ ...broker, environment: e.target.value as "demo" | "live" })} className={INPUT_CLS}>
                    <option value="demo">Demo</option>
                    <option value="live">Real</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Account reference</label>
                <input value={broker.accountId} onChange={(e) => setBroker({ ...broker, accountId: e.target.value })} placeholder="Optional tag — never enter secrets" className={INPUT_CLS} />
              </div>
              <Button variant="secondary" size="sm" onClick={() => patch({ brokerConfig: { ...broker, lastCheckedAt: new Date().toISOString() } }, "Broker saved. Automated execution stays off until explicitly authorized.")}>
                Save
              </Button>
            </div>
          </Row>
          <Row
            icon={<BookOpen className="h-4 w-4" />}
            title="Data feeds"
            subtitle={`${data.feeds.filter((f) => f.status === "LIVE").length} of ${data.feeds.length} responding`}
            onClick={() => setOpen(open === "feeds" ? null : "feeds")}
            expanded={open === "feeds"}
          >
            <div className="space-y-1.5">
              {data.feeds.map((f) => (
                <div key={f.id} className="freyr-card flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-ink">{f.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[9.5px] text-ink-tertiary">{f.endpoint}</div>
                  </div>
                  <DataStatusBadge status={f.status} />
                </div>
              ))}
            </div>
          </Row>
        </div>
      )}

      {/* Logout at the very bottom */}
      <div className="border-t border-ink/[0.07] pt-3 pb-2">
        {data.isAuthenticated ? (
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-bear/25 bg-bear/[0.08] px-4 py-3 text-[12px] font-semibold text-bear transition-colors hover:bg-bear/[0.14] cursor-pointer"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setAuthMode("login"); setOpen("edit"); window.scrollTo({ top: 0 }); }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-ink/[0.09] bg-ink/[0.04] px-4 py-3 text-[12px] font-semibold text-ink transition-colors hover:bg-ink/[0.07] cursor-pointer"
          >
            <KeyRound className="h-4 w-4" /> Sign in to your account
          </button>
        )}
      </div>
    </div>
  );
}
