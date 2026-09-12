import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  LuActivity,
  LuArrowRight,
  LuBlocks,
  LuFileText,
  LuLayoutDashboard,
  LuMoon,
  LuPlus,
  LuRefreshCw,
  LuSettings,
  LuSun,
  LuTrash2,
  LuX,
} from 'react-icons/lu';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { SiClaude, SiOpencode } from 'react-icons/si';
import './index.css';
import type { ConfigPayload, DiagnosticEntry, TrackemConfig, UsageSnapshot, UsageSnapshotPayload } from './types';
import { computePace, formatDuration, percentLeft } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const IS_MAC = /Mac/.test(navigator.platform);

/** Rasterize the react-icons Codex mark at each platform's preferred tray size. */
function useTrayIcon(): void {
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const timer = window.setTimeout(() => {
      const pixels = IS_MAC ? 36 : 32;
      const inset = 2;
      const iconSize = pixels - inset * 2;
      // Mount the actual react-icons component briefly, then serialize its SVG.
      const host = document.createElement('div');
      const iconRoot = createRoot(host);
      flushSync(() => iconRoot.render(<AiOutlineOpenAI color={IS_MAC ? '#000' : '#fff'} size={iconSize} />));
      const svg = host.querySelector('svg');
      if (!svg) {
        iconRoot.unmount();
        return;
      }
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svgMarkup = new XMLSerializer().serializeToString(svg);
      iconRoot.unmount();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
      const image = new Image();
      image.onload = () => {
        if (!cancelled) {
          const canvas = document.createElement('canvas');
          canvas.width = pixels;
          canvas.height = pixels;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(image, inset, inset, iconSize, iconSize);
            window.trackem?.setTrayIcon(canvas.toDataURL('image/png'));
          }
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      };
      image.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      };
      image.src = objectUrl;
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
}

interface ProviderBrand {
  id: string;
  name: string;
  topModel: string;
  authHint: string;
  color: string;
  neutralChip?: boolean;
  logo: React.ReactNode;
}

const CODEX_BRAND: ProviderBrand = {
  id: 'codex',
  name: 'Codex',
  topModel: 'GPT-5.3 Codex',
  authHint: 'OAuth · auth.json',
  color: '#7555dc',
  neutralChip: true,
  logo: <AiOutlineOpenAI size={19} />,
};

const CONNECTABLE_PROVIDERS: ProviderBrand[] = [
  {
    id: 'open-code',
    name: 'OpenCode',
    topModel: 'Claude Sonnet 4.5',
    authHint: 'API key · opencode.ai',
    color: '#141413',
    logo: <SiOpencode size={19} />,
  },
  {
    id: 'claude',
    name: 'Claude',
    topModel: 'Claude Sonnet 4.5',
    authHint: 'OAuth · API key',
    color: '#d97757',
    logo: <SiClaude size={19} />,
  },
];

function ProviderLogoChip({ brand, className }: { brand: ProviderBrand; className?: string }) {
  return (
    <div
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg',
        brand.neutralChip ? 'bg-muted text-foreground' : '',
        className,
      )}
      style={brand.neutralChip ? undefined : { backgroundColor: `${brand.color}1f`, color: brand.color }}
    >
      {brand.logo}
    </div>
  );
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('trackem-theme');
    return stored === 'dark' || stored === 'light'
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('trackem-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}

const CONNECTION_HINTS: Record<string, string> = {
  'missing-credential': 'Connect Codex',
  'malformed-credential': 'Fix credentials',
  'authentication-expired': 'Re-authenticate',
  'network-failure': 'Network error',
};

function formatPlan(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function WindowStat({
  label,
  usedPercent,
  resetAt,
  windowSeconds,
  durationStyle,
}: {
  label: string;
  usedPercent: number;
  resetAt: string | null;
  windowSeconds: number | null;
  durationStyle: 'hours' | 'days';
}) {
  const left = percentLeft(usedPercent);
  const pace = computePace(usedPercent, resetAt, windowSeconds);
  const countdown = resetAt ? (new Date(resetAt).getTime() - Date.now()) / 1000 : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-bold text-foreground">{label} {left}% left</span>
        <span className="text-xs text-muted-foreground">
          {countdown !== null && countdown > 0
            ? `Resets in ${formatDuration(countdown, durationStyle)}`
            : 'Reset time unavailable'}
        </span>
      </div>
      <div className="relative">
        <Progress value={left} className="h-1.5" />
        {pace && (
          <>
            <span
              className={cn(
                'absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full',
                usedPercent <= pace.expected ? 'bg-emerald-500' : 'bg-red-500',
              )}
              style={{ left: `calc(${100 - pace.expected}% - 1px)` }}
            />
            {[25, 50, 75].map((position) => (
              <span key={position} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/15" style={{ left: `${position}%` }} />
            ))}
          </>
        )}
      </div>
      {pace && (
        <p className="text-xs text-muted-foreground">
          {pace.reserve > 0 && <>{pace.reserve}% in reserve · </>}
          {pace.willLast
            ? 'Lasts until reset'
            : pace.etaSeconds !== null && `Runs out in ${formatDuration(pace.etaSeconds, durationStyle)}`}
        </p>
      )}
    </div>
  );
}

function ReserveStat({ reserve }: { reserve: NonNullable<UsageSnapshot['reserve']> }) {
  const dates = [...new Set(reserve.expirations.map((iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })))];
  return (
    <p className="text-xs text-muted-foreground">
      Reserves: <span className="font-semibold text-foreground">{reserve.available}</span>
      {dates.length > 0 && <> · Expires: <span className="font-semibold text-foreground">{dates.join(', ')}</span></>}
    </p>
  );
}

function CodexRow({ snapshot, refreshing }: { snapshot: UsageSnapshot | null; refreshing: boolean }) {
  if (!snapshot) {
    return (
      <div className="py-5">
        <div className="flex items-center gap-3">
          <ProviderLogoChip brand={CODEX_BRAND} />
          <div className="space-y-1">
            <p className="text-sm font-bold">Codex</p>
            <p className="text-xs text-muted-foreground">{refreshing ? 'Fetching usage…' : 'Waiting for first refresh'}</p>
          </div>
          <Spinner className="ml-auto" />
        </div>
        <div className="mt-4 grid gap-6 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      </div>
    );
  }

  if (!snapshot.ok || snapshot.error) {
    const hint = CONNECTION_HINTS[snapshot.error?.kind ?? ''] ?? 'Check Codex setup';
    return (
      <div className="flex items-start gap-3 py-5">
        <ProviderLogoChip brand={CODEX_BRAND} />
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-bold">{snapshot.account.label}</p>
          <p className="text-xs font-semibold text-destructive">{hint}</p>
          <p className="break-words text-xs text-muted-foreground">{snapshot.error?.message}</p>
        </div>
      </div>
    );
  }

  const fiveHour = snapshot.windows.fiveHour;
  const weekly = snapshot.windows.weekly;
  return (
    <div className="py-5">
      <div className="flex items-center gap-3">
        <ProviderLogoChip brand={CODEX_BRAND} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{snapshot.account.label}</p>
          <p className="truncate text-xs text-muted-foreground">Codex · {snapshot.plan ? formatPlan(snapshot.plan) : 'Plan unavailable'}</p>
        </div>
        <span className="ml-auto size-2 rounded-full bg-emerald-500" title="Connected" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {fiveHour
          ? <WindowStat label="Session" usedPercent={fiveHour.usedPercent} resetAt={fiveHour.resetAt} windowSeconds={fiveHour.windowSeconds} durationStyle="hours" />
          : <p className="text-xs text-muted-foreground">5-hour window not provided</p>}
        {weekly
          ? <WindowStat label="Weekly" usedPercent={weekly.usedPercent} resetAt={weekly.resetAt} windowSeconds={weekly.windowSeconds} durationStyle="days" />
          : <p className="text-xs text-muted-foreground">Weekly window not provided</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {snapshot.reserve && <ReserveStat reserve={snapshot.reserve} />}
        <p className="text-muted-foreground">Top model <span className="font-semibold text-foreground">{snapshot.topModel ?? CODEX_BRAND.topModel}</span></p>
      </div>
    </div>
  );
}

function MiniQuota({ label, usedPercent }: { label: string; usedPercent?: number }) {
  const left = usedPercent === undefined ? null : percentLeft(usedPercent);
  return (
    <div className="min-w-24 space-y-1">
      <div className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{label}</span><strong>{left === null ? '—' : `${left}%`}</strong></div>
      <Progress value={left ?? 0} className="h-1" />
    </div>
  );
}

function ManagementRow({ snapshot }: { snapshot: UsageSnapshot }) {
  return (
    <div className="grid gap-4 py-4 sm:grid-cols-[minmax(180px,1.7fr)_minmax(75px,.6fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(80px,.7fr)] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogoChip brand={CODEX_BRAND} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{snapshot.account.label}</p>
          <p className="truncate text-xs text-muted-foreground" title={snapshot.source}>{snapshot.account.isDefault ? 'Default profile' : snapshot.account.home}</p>
          {!snapshot.ok && <p className="mt-1 text-xs font-semibold text-destructive">{CONNECTION_HINTS[snapshot.error?.kind ?? ''] ?? 'Unavailable'}</p>}
        </div>
      </div>
      <div className="text-xs"><span className="sm:hidden text-muted-foreground">Plan · </span><strong>{snapshot.plan ? formatPlan(snapshot.plan) : '—'}</strong></div>
      <MiniQuota label="Session" usedPercent={snapshot.windows.fiveHour?.usedPercent} />
      <MiniQuota label="Weekly" usedPercent={snapshot.windows.weekly?.usedPercent} />
      <div className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{snapshot.reserve?.available ?? 0}</span> reserves</div>
    </div>
  );
}

function ConnectableRow({ brand }: { brand: ProviderBrand }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <ProviderLogoChip brand={brand} className="dark:opacity-80" />
      <div className="min-w-0"><p className="text-sm font-bold">{brand.name}</p><p className="truncate text-xs text-muted-foreground">Not connected · {brand.authHint}</p></div>
      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" className="ml-auto"><LuPlus />Connect</Button></TooltipTrigger><TooltipContent>Coming soon</TooltipContent></Tooltip></TooltipProvider>
    </div>
  );
}

function ProvidersPage({ snapshots }: { snapshots: UsageSnapshot[] }) {
  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-baseline justify-between border-b pb-3"><h2 className="font-heading text-lg font-bold">Codex accounts</h2><span className="text-xs text-muted-foreground">{snapshots.filter((item) => item.ok).length} connected</span></div>
        <div className="hidden grid-cols-[minmax(180px,1.7fr)_minmax(75px,.6fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(80px,.7fr)] gap-4 border-b py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:grid">
          <span>Account</span><span>Plan</span><span>5-hour</span><span>Weekly</span><span>Resets</span>
        </div>
        {snapshots.map((snapshot, index) => <React.Fragment key={snapshot.account.id}>{index > 0 && <Separator />}<ManagementRow snapshot={snapshot} /></React.Fragment>)}
        {snapshots.length === 0 && <CodexRow snapshot={null} refreshing />}
      </section>
      <section>
        <h2 className="border-b pb-3 font-heading text-lg font-bold">Available to connect</h2>
        {CONNECTABLE_PROVIDERS.map((brand, index) => <React.Fragment key={brand.id}>{index > 0 && <Separator />}<ConnectableRow brand={brand} /></React.Fragment>)}
      </section>
    </div>
  );
}

function DiagnosticsPage({ entries }: { entries: DiagnosticEntry[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b pb-3"><h2 className="font-heading text-lg font-bold">Refresh activity</h2><span className="text-xs text-muted-foreground">Latest 100 events</span></div>
      {entries.length ? entries.map((entry, index) => (
        <React.Fragment key={entry.id}>
          {index > 0 && <Separator />}
          <div className="grid gap-1 py-3 sm:grid-cols-[110px_90px_minmax(0,1fr)] sm:gap-4">
            <time className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</time>
            <div className="flex items-center gap-2 text-xs font-semibold"><span className={cn('size-1.5 rounded-full', entry.level === 'error' ? 'bg-red-500' : 'bg-emerald-500')} />{entry.accountLabel ?? entry.providerId}</div>
            <p className="break-words text-xs text-muted-foreground">{entry.message}</p>
          </div>
        </React.Fragment>
      )) : <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><LuActivity /></EmptyMedia><EmptyTitle>No activity yet</EmptyTitle><EmptyDescription>Refresh activity will appear here.</EmptyDescription></EmptyHeader></Empty>}
    </section>
  );
}

function SettingsPage({ configPayload, onSaved }: { configPayload: ConfigPayload | null; onSaved: (payload: ConfigPayload) => void }) {
  const [draft, setDraft] = useState<TrackemConfig | null>(configPayload?.config ?? null);
  const [newHome, setNewHome] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (configPayload) setDraft(configPayload.config); }, [configPayload]);
  if (!draft) return <Spinner />;

  const addHome = () => {
    const home = newHome.trim();
    if (!home || draft.codexProfileHomes.includes(home)) return;
    setDraft({ ...draft, codexProfileHomes: [...draft.codexProfileHomes, home] });
    setNewHome('');
  };
  const save = () => {
    setSaving(true);
    void window.trackem?.setConfig(draft).then(onSaved).finally(() => setSaving(false));
  };

  return (
    <div className="space-y-10">
      <section>
        <h2 className="border-b pb-3 font-heading text-lg font-bold">Codex profiles</h2>
        <p className="py-3 text-sm text-muted-foreground">The default <code>~/.codex</code> profile is always monitored. Add other Codex home directories to compare multiple subscriptions.</p>
        {draft.codexProfileHomes.map((home) => (
          <div key={home} className="flex items-center gap-3 border-t py-3">
            <AiOutlineOpenAI className="shrink-0" />
            <code className="min-w-0 flex-1 truncate text-xs">{home}</code>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${home}`} onClick={() => setDraft({ ...draft, codexProfileHomes: draft.codexProfileHomes.filter((item) => item !== home) })}><LuTrash2 /></Button>
          </div>
        ))}
        <div className="flex gap-2 border-t pt-4">
          <input className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={newHome} onChange={(event) => setNewHome(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addHome(); }} placeholder="/Users/you/.codex-work" aria-label="Additional Codex home" />
          <Button variant="outline" onClick={addHome} disabled={!newHome.trim()}><LuPlus />Add profile</Button>
        </div>
      </section>
      <section>
        <h2 className="border-b pb-3 font-heading text-lg font-bold">Notifications</h2>
        <div className="flex items-center justify-between gap-4 py-4">
          <div><p className="text-sm font-bold">Reset expiry warnings</p><p className="text-xs text-muted-foreground">Notify before a banked Codex reset expires.</p></div>
          <Switch checked={draft.notifyOnResetExpiry} onCheckedChange={(checked) => setDraft({ ...draft, notifyOnResetExpiry: checked })} aria-label="Reset expiry warnings" />
        </div>
        <div className="flex items-center justify-between gap-4 border-t py-4">
          <div><p className="text-sm font-bold">Warning window</p><p className="text-xs text-muted-foreground">Number of days before expiry.</p></div>
          <input type="number" min={1} max={30} className="h-8 w-20 rounded-lg border bg-background px-3 text-sm" value={draft.resetExpiryDays} onChange={(event) => setDraft({ ...draft, resetExpiryDays: Number(event.target.value) })} aria-label="Reset expiry warning days" />
        </div>
      </section>
      <div className="flex items-center justify-between border-t pt-4"><p className="truncate pr-4 text-xs text-muted-foreground" title={configPayload?.file}>Config: {configPayload?.file}</p><Button onClick={save} disabled={saving}>{saving ? <Spinner /> : null}Save changes</Button></div>
    </div>
  );
}

const NAV_GROUPS = [
  { label: 'Monitor', items: [{ id: 'Overview', icon: LuLayoutDashboard }, { id: 'Providers', icon: LuBlocks }] },
  { label: 'Insights', items: [{ id: 'Diagnostics', icon: LuFileText }] },
  { label: 'Control', items: [{ id: 'Settings', icon: LuSettings }] },
] as const;

function App() {
  useTrayIcon();
  const [active, setActive] = useState('Overview');
  const [codex, setCodex] = useState<UsageSnapshot[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [configPayload, setConfigPayload] = useState<ConfigPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const { dark, toggle } = useTheme();

  const applyPayload = useCallback((next: UsageSnapshotPayload) => {
    setCodex(Array.isArray(next.codex) ? next.codex : []);
    setDiagnostics(Array.isArray(next.diagnostics) ? next.diagnostics : []);
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    const api = window.trackem;
    if (!api) return;
    void api.getUsage().then(applyPayload);
    void api.getConfig().then(setConfigPayload);
    return api.onUsageUpdated(applyPayload);
  }, [applyPayload]);

  const handleRefresh = useCallback(() => {
    if (!window.trackem) return;
    setRefreshing(true);
    void window.trackem.refreshUsage().finally(() => setRefreshing(false));
  }, []);

  const connected = codex.filter((snapshot) => snapshot.ok);
  const best = useMemo(() => [...connected].sort((a, b) => (a.windows.weekly?.usedPercent ?? 101) - (b.windows.weekly?.usedPercent ?? 101))[0] ?? null, [connected]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="grid h-[52px] shrink-0 grid-cols-[88px_1fr_88px] items-center border-b bg-card select-none [-webkit-app-region:drag]">
        <div className="h-full [-webkit-app-region:no-drag]" />
        <div className="flex items-center gap-2 justify-self-center font-heading text-base font-bold"><span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground"><AiOutlineOpenAI /></span>trackem</div>
        <div className="h-full [-webkit-app-region:no-drag]" />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col border-r bg-sidebar p-2 md:w-[218px] md:p-3">
          {NAV_GROUPS.map((group) => <div key={group.label} className="mb-4"><p className="hidden px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.09em] text-muted-foreground md:block">{group.label}</p><nav className="flex flex-col gap-1">{group.items.map((item) => <Button key={item.id} variant={active === item.id ? 'secondary' : 'ghost'} className="w-full justify-start max-md:justify-center max-md:px-0" onClick={() => setActive(item.id)} aria-label={item.id}><item.icon /><span className="max-md:hidden">{item.id}</span></Button>)}</nav></div>)}
          <div className="mt-auto"><Separator className="mb-2 max-md:hidden" /><TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="text-muted-foreground max-md:mx-auto" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <LuSun /> : <LuMoon />}</Button></TooltipTrigger><TooltipContent side="right">{dark ? 'Light theme' : 'Dark theme'}</TooltipContent></Tooltip></TooltipProvider></div>
        </aside>
        <main className="flex-1 overflow-x-hidden overflow-y-auto px-5 py-6 md:px-10 md:py-8 2xl:px-16">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-heading text-2xl font-bold md:text-3xl">{active}</h1>
            <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh usage">{refreshing ? <Spinner /> : <LuRefreshCw />}</Button>{active !== 'Providers' && <Button variant="outline" onClick={() => setActive('Providers')}><LuSettings /><span className="max-sm:hidden">Manage providers</span></Button>}{!IS_MAC && <Button variant="ghost" size="icon" onClick={() => window.trackem?.minimize()} aria-label="Hide to tray"><LuX /></Button>}</div>
          </header>
          {active === 'Overview' ? (
            <div className="space-y-8">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"><div className="space-y-1"><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">{connected.length ? 'All systems normal' : 'No providers linked'}</p><h2 className="font-heading text-xl font-bold md:text-2xl">Your usage at a glance</h2></div><p className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('size-1.5 rounded-full', refreshing ? 'bg-muted-foreground' : 'bg-emerald-500')} />{refreshing ? 'Refreshing…' : lastUpdated ? `Synced ${lastUpdated}` : 'Waiting for sync'}</p></div>
              {best && connected.length > 1 && <div className="flex items-center justify-between gap-4 border-b pb-5"><div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Best account right now</p><p className="mt-1 text-sm font-bold">{best.account.label}</p></div><p className="text-xs text-muted-foreground">{best.windows.weekly ? `${percentLeft(best.windows.weekly.usedPercent)}% weekly left` : 'Most available headroom'}</p></div>}
              {connected.length ? <section><div className="flex items-baseline justify-between"><h2 className="font-heading text-lg font-bold">Codex</h2><Button variant="link" size="sm" onClick={() => setActive('Providers')}>{connected.length} account{connected.length === 1 ? '' : 's'}<LuArrowRight /></Button></div>{connected.map((snapshot, index) => <React.Fragment key={snapshot.account.id}>{index > 0 && <Separator />}<CodexRow snapshot={snapshot} refreshing={refreshing} /></React.Fragment>)}</section> : <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><AiOutlineOpenAI /></EmptyMedia><EmptyTitle>No connected providers</EmptyTitle><EmptyDescription>Sign in with the Codex CLI or configure an additional profile.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setActive('Providers')}>Manage providers</Button></EmptyContent></Empty>}
            </div>
          ) : active === 'Providers' ? <ProvidersPage snapshots={codex} /> : active === 'Diagnostics' ? <DiagnosticsPage entries={diagnostics} /> : <SettingsPage configPayload={configPayload} onSaved={setConfigPayload} />}
        </main>
      </div>
    </div>
  );
}

const container = document.getElementById('root')!;
const root = (container as unknown as { __trackemRoot?: ReturnType<typeof createRoot> }).__trackemRoot ?? createRoot(container);
(container as unknown as { __trackemRoot?: ReturnType<typeof createRoot> }).__trackemRoot = root;
root.render(<App />);
