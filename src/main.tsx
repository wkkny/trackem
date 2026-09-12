import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuActivity, LuBlocks, LuFileText, LuLayoutDashboard, LuMoon, LuRefreshCw, LuSettings, LuSun, LuX } from 'react-icons/lu';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { SiClaude } from 'react-icons/si';
import './index.css';
import type { ConfigPayload, DiagnosticEntry, UsageSnapshot, UsageSnapshotPayload, UsageWindow } from './types';
import { formatDuration, percentLeft } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { SettingsPage } from '@/components/settings';
import { ResearchPage } from '@/components/research';

const IS_MAC = /Mac/.test(navigator.platform);
const name = (id: UsageSnapshot['providerId']) => id === 'codex' ? 'Codex' : 'Claude';

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('trackem-theme');
    return stored === 'dark' || stored === 'light' ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('trackem-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark(value => !value) };
}

function forecastText(window: UsageWindow, stale: boolean, now: number): string {
  if (stale || window.forecast?.status === 'stale') return 'Refresh needed before estimating';
  if (window.usedPercent >= 100) return 'Quota exhausted. Wait for reset.';
  const forecast = window.forecast;
  if (!forecast || forecast.status === 'collecting') return 'Learning your pace. Needs 3 readings over at least 10 minutes.';
  if (forecast.status === 'idle') return 'No usage increase observed. Run-out time unknown.';
  if (forecast.status === 'lasts') return 'Estimated to last until reset at your recent pace';
  if (forecast.runsOutAt) {
    const seconds = (Date.parse(forecast.runsOutAt) - now) / 1000;
    if (seconds <= 0) return 'Estimated limit time reached. Refresh to check.';
    return `Estimated to run out in ${formatDuration(seconds, seconds >= 86_400 ? 'days' : 'hours')} · ${new Date(forecast.runsOutAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }
  return 'Run-out time unavailable';
}

function WindowStat({ window, updatedAt, now }: { window: UsageWindow; updatedAt: string; now: number }) {
  const left = percentLeft(window.usedPercent);
  const countdown = window.resetAt ? (Date.parse(window.resetAt) - now) / 1000 : null;
  const stale = now - Date.parse(updatedAt) > 15 * 60_000 || (countdown !== null && countdown <= 0);
  const label = window.id === 'fiveHour' ? 'Session' : 'Weekly';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold">{label} {left}% left{stale ? ' at last check' : ''}</span>
        <span className="text-xs text-muted-foreground">{countdown !== null && countdown > 0 ? `Resets in ${formatDuration(countdown, window.id === 'fiveHour' ? 'hours' : 'days')}` : 'Reset time unavailable'}</span>
      </div>
      <Progress value={left} className="h-1.5" aria-label={`${label} quota remaining`} />
      <p className={cn('text-xs', !stale && window.forecast?.status === 'depleting' ? 'text-destructive' : 'text-muted-foreground')}>{forecastText(window, stale, now)}</p>
      {!stale && (window.forecast?.sampleMinutes ?? 0) >= 10 && <p className="text-xs text-muted-foreground">Based on the last {Math.round(window.forecast!.sampleMinutes)} minutes. Usage can change.</p>}
    </div>
  );
}

function ProviderRow({ snapshot, now }: { snapshot: UsageSnapshot; now: number }) {
  const Logo = snapshot.providerId === 'codex' ? AiOutlineOpenAI : SiClaude;
  return (
    <article className="py-5">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Logo size={19} /></div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold">{snapshot.account.label}</h3>
          <p className="text-xs text-muted-foreground">{name(snapshot.providerId)} · {snapshot.ok ? snapshot.plan ?? 'Plan unavailable' : 'Unavailable'}</p>
        </div>
      </div>
      {!snapshot.ok ? <p className="mt-3 break-words text-xs text-destructive">{snapshot.error?.message ?? 'Usage unavailable. Try refreshing.'}</p> : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {Object.values(snapshot.windows).map(window => <WindowStat key={window.id} window={window} updatedAt={snapshot.updatedAt} now={now} />)}
          </div>
          <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
            {snapshot.reserve?.available != null && <p>Banked resets: {snapshot.reserve.available}{snapshot.reserve.nextExpiresAt ? ` · Next expires ${new Date(snapshot.reserve.nextExpiresAt).toLocaleDateString()}` : ''}</p>}
            {snapshot.topModel && <p>Top local model: {snapshot.topModel}</p>}
            <p>Provider data checked <time dateTime={snapshot.updatedAt}>{new Date(snapshot.updatedAt).toLocaleTimeString()}</time></p>
          </div>
        </>
      )}
    </article>
  );
}

function ProviderList({ snapshots, now }: { snapshots: UsageSnapshot[]; now: number }) {
  return snapshots.map(snapshot => <React.Fragment key={`${snapshot.providerId}:${snapshot.account.id}:${snapshot.account.home}`}><ProviderRow snapshot={snapshot} now={now} /><Separator /></React.Fragment>);
}

function DiagnosticsPage({ entries }: { entries: DiagnosticEntry[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b pb-3"><h2 className="font-heading text-lg font-bold">Refresh activity</h2><span className="text-xs text-muted-foreground">Latest 100 events, this session only</span></div>
      {entries.map(entry => <div key={entry.id} className="flex flex-col gap-1 border-b py-3">
        <p className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()} · {entry.accountLabel ?? entry.providerId}</p>
        <p className={cn('break-words text-xs', entry.level === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{entry.message}</p>
      </div>)}
      {!entries.length && <p className="py-6 text-sm text-muted-foreground">No activity yet.</p>}
    </section>
  );
}

const NAV_GROUPS = [
  { label: 'Monitor', items: [{ id: 'Overview', icon: LuLayoutDashboard }, { id: 'Providers', icon: LuBlocks }] },
  { label: 'Insights', items: [{ id: 'Diagnostics', icon: LuFileText }, { id: 'Early feedback', icon: LuActivity }] },
  { label: 'Control', items: [{ id: 'Settings', icon: LuSettings }] },
] as const;

function App() {
  const [active, setActive] = useState('Overview');
  const [data, setData] = useState<UsageSnapshotPayload>({ codex: [], claude: [], diagnostics: [], lastCheckedAt: null, view: 'dashboard' });
  const [configPayload, setConfigPayload] = useState<ConfigPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const { dark, toggle } = useTheme();
  const applyPayload = useCallback((next: UsageSnapshotPayload) => { setData(next); setNow(Date.now()); }, []);

  useEffect(() => {
    const api = window.trackem;
    if (!api) { setError('Open Trackem as a desktop app to read local provider data. Browser previews do not contain sample quotas.'); return; }
    const unsubscribe = api.onUsageUpdated(applyPayload);
    void api.getUsage().then(applyPayload).catch(() => setError('Could not load provider data.'));
    void api.getConfig().then(setConfigPayload).catch(() => setError('Could not load preferences.'));
    return unsubscribe;
  }, [applyPayload]);
  useEffect(() => {
    // No renderer timer while hidden. Native provider polling is independent.
    let timer: number | undefined;
    const update = () => {
      window.clearInterval(timer);
      if (!document.hidden) { setNow(Date.now()); timer = window.setInterval(() => setNow(Date.now()), 60_000); }
    };
    document.addEventListener('visibilitychange', update); update();
    return () => { document.removeEventListener('visibilitychange', update); window.clearInterval(timer); };
  }, []);

  const handleRefresh = useCallback(() => {
    if (!window.trackem) return;
    setRefreshing(true); setError('');
    void window.trackem.refreshUsage().catch(() => setError('Refresh failed. Try again.')).finally(() => setRefreshing(false));
  }, []);
  const snapshots = [...data.codex, ...data.claude];
  const connected = snapshots.filter(snapshot => snapshot.ok);
  const readyCodex = data.codex.filter(s => s.ok && s.windows.fiveHour && s.windows.weekly && Date.parse(s.updatedAt) > now - 15 * 60_000 && Object.values(s.windows).every(w => w.resetAt && Date.parse(w.resetAt) > now));
  const best = readyCodex.length > 1 ? [...readyCodex].sort((a, b) => Math.max(...Object.values(a.windows).map(w => w.usedPercent)) - Math.max(...Object.values(b.windows).map(w => w.usedPercent)))[0] : null;
  const refreshButton = <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing || !window.trackem} aria-label="Refresh usage">{refreshing ? <Spinner /> : <LuRefreshCw />}</Button>;

  if (data.view === 'popover') return (
    <main className="flex h-screen flex-col bg-background text-foreground" aria-label="Trackem tray usage">
      <header className="flex shrink-0 items-center justify-between border-b p-4"><h1 className="font-heading text-lg font-bold">Trackem</h1><div className="flex gap-2">{refreshButton}<Button variant="ghost" size="icon" onClick={() => window.trackem?.minimize()} aria-label="Hide to tray"><LuX /></Button></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {error && <p role="alert" className="py-3 text-sm text-destructive">{error}</p>}
        <ProviderList snapshots={snapshots} now={now} />
        {!snapshots.length && <p className="py-6 text-sm text-muted-foreground">{data.lastCheckedAt ? 'Monitoring is disabled. Open Settings to enable a provider.' : 'Checking local provider logins…'}</p>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t p-4"><p className="text-xs text-muted-foreground">Credentials stay local</p><Button variant="outline" onClick={() => window.trackem?.openDashboard()}>Open dashboard</Button></footer>
    </main>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="grid h-[52px] shrink-0 grid-cols-[88px_1fr_88px] items-center border-b bg-card select-none [-webkit-app-region:drag]">
        <div /><div className="justify-self-center font-heading text-base font-bold">trackem</div>
        <div className="justify-self-end pr-3 [-webkit-app-region:no-drag]">{!IS_MAC && <Button variant="ghost" size="icon" onClick={() => window.trackem?.minimize()} aria-label="Hide to tray"><LuX /></Button>}</div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col border-r bg-sidebar p-2 md:w-[218px] md:p-3">
          {NAV_GROUPS.map(group => <div key={group.label} className="mb-4"><p className="hidden px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.09em] text-muted-foreground md:block">{group.label}</p><nav aria-label={group.label} className="flex flex-col gap-1">{group.items.map(item => <Button key={item.id} variant={active === item.id ? 'secondary' : 'ghost'} className="w-full justify-start max-md:justify-center max-md:px-0" onClick={() => setActive(item.id)} aria-label={item.id} aria-current={active === item.id ? 'page' : undefined}><item.icon data-icon="inline-start" /><span className="max-md:hidden">{item.id}</span></Button>)}</nav></div>)}
          <div className="mt-auto"><Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <LuSun /> : <LuMoon />}</Button></div>
        </aside>
        <main className="flex-1 overflow-x-hidden overflow-y-auto px-5 py-6 md:px-10 md:py-8">
          <header className="mb-8 flex items-center justify-between gap-4"><h1 className="font-heading text-2xl font-bold md:text-3xl">{active}</h1>{refreshButton}</header>
          {error && <p role="alert" className="mb-6 text-sm text-destructive">{error}</p>}
          {active === 'Overview' || active === 'Providers' ? <div className="flex flex-col gap-6">
            <section className="border-b pb-5"><h2 className="font-heading text-xl font-bold">{active === 'Overview' ? 'Your usage at a glance' : 'Codex and Claude connections'}</h2><p className="mt-2 text-sm text-muted-foreground">{connected.length} connected · {snapshots.length - connected.length} unavailable</p><p className="mt-1 text-xs text-muted-foreground">{data.lastCheckedAt ? `Last check ${new Date(data.lastCheckedAt).toLocaleString()}` : 'Waiting for first check'}</p></section>
            {active === 'Providers' && <section className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">Sign in with <code>codex login</code> or <code>claude</code>, then refresh. Trackem reads existing OAuth logins. API keys cannot report subscription quotas.</p><Button variant="outline" className="self-start" onClick={() => setActive('Settings')}>Provider access and profile settings</Button></section>}
            {best && active === 'Overview' && <section className="border-b pb-4"><p className="text-xs text-muted-foreground">Codex account with the most headroom across both windows</p><p className="mt-1 text-sm font-bold">{best.account.label}</p></section>}
            <section><ProviderList snapshots={snapshots} now={now} /></section>
            {!snapshots.length && <Empty><EmptyHeader><EmptyMedia variant="icon"><AiOutlineOpenAI /></EmptyMedia><EmptyTitle>{data.lastCheckedAt ? 'No providers enabled' : 'Waiting for provider data'}</EmptyTitle><EmptyDescription>Trackem shows only provider-reported quotas. Enable local access in Settings.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setActive('Settings')}>Open settings</Button></EmptyContent></Empty>}
          </div> : active === 'Diagnostics' ? <DiagnosticsPage entries={data.diagnostics} /> : active === 'Early feedback' ? <ResearchPage enabled={configPayload?.config.localResearch ?? false} openSettings={() => setActive('Settings')} /> : <SettingsPage configPayload={configPayload} onSaved={setConfigPayload} />}
        </main>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Trackem root element is missing');
const root = (container as unknown as { __trackemRoot?: ReturnType<typeof createRoot> }).__trackemRoot ?? createRoot(container);
(container as unknown as { __trackemRoot?: ReturnType<typeof createRoot> }).__trackemRoot = root;
root.render(<App />);
