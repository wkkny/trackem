import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@trackem/ui/components/button';
import { Separator } from '@trackem/ui/components/separator';
import { TrackemMark } from '@trackem/ui/brand';
import { AiOutlineOpenAI, SiClaude } from '@trackem/ui/icons';
import './index.css';

const repository = 'https://github.com/wkkny/trackem';

function Website() {
  return <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 md:px-12">
    <a href="#main" className="sr-only focus:not-sr-only focus:py-3 focus:underline">Skip to content</a>
    <header className="flex flex-wrap items-center justify-between gap-4 py-7">
      <a href="#main" aria-label="Trackem home" className="flex items-center gap-2 text-lg font-semibold">
        <TrackemMark className="size-6" />Trackem
      </a>
      <nav aria-label="Main" className="flex gap-4">
        <Button asChild variant="ghost"><a href="#how-it-works">How it works</a></Button>
        <Button asChild variant="outline"><a href={repository}>View project</a></Button>
      </nav>
    </header>
    <main id="main" className="flex-1">
      <section className="grid items-center gap-12 py-20 md:grid-cols-[1.5fr_1fr] md:py-28">
        <div className="flex flex-col items-start gap-6">
          <p className="text-sm text-muted-foreground">A quiet companion for your coding subscriptions</p>
          <h1 className="max-w-xl text-5xl font-semibold tracking-tight md:text-7xl">Know what's left.<br />Keep building.</h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">Codex and Claude Code usage, one glance away. A native menu-bar popover on macOS, a system-tray window on Windows, and the same dashboard on both.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg"><a href={repository}>Explore Trackem</a></Button>
            <Button asChild size="lg" variant="outline"><a href={repository + '#development'}>Build it locally</a></Button>
          </div>
          <p className="text-xs text-muted-foreground">In development. Signed installers are not available from this site yet.</p>
        </div>
        <div className="flex aspect-square items-center justify-center rounded-3xl border bg-muted" aria-hidden="true">
          <TrackemMark className="size-40 md:size-48" />
        </div>
      </section>
      <Separator />
      <section id="how-it-works" className="flex flex-col gap-10 py-16">
        <div className="flex flex-col gap-3">
          <h2 className="text-3xl font-semibold tracking-tight">Your subscriptions. Your machine.</h2>
          <p className="max-w-2xl text-muted-foreground">Sign in through the CLI tools you already use. Trackem reads their existing logins and asks each provider for your subscription quota.</p>
          <div className="flex gap-6 pt-2 text-sm"><span className="flex items-center gap-2"><AiOutlineOpenAI aria-hidden="true" />Codex</span><span className="flex items-center gap-2"><SiClaude aria-hidden="true" />Claude Code</span></div>
        </div>
        <div className="grid gap-10 md:grid-cols-2">
          <section className="flex flex-col gap-3"><h3 className="text-lg font-semibold">See the actual quota</h3><p className="leading-relaxed text-muted-foreground">Session and weekly limits come from the provider. Reset countdowns show when to check again. Missing or expired credentials show an unavailable state.</p></section>
          <section className="flex flex-col gap-3"><h3 className="text-lg font-semibold">Keep access local</h3><p className="leading-relaxed text-muted-foreground">There is no Trackem backend or automatic telemetry. Trackem does not refresh or rewrite your CLI credentials. Optional local analysis is off by default.</p></section>
        </div>
      </section>
      <Separator />
      <section className="grid gap-8 py-16 md:grid-cols-2">
        <div className="flex flex-col gap-3"><h2 className="text-2xl font-semibold">At home on macOS</h2><p className="leading-relaxed text-muted-foreground">Swift and AppKit handle the menu-bar icon, popover, and native controls. The system chooses their appearance.</p></div>
        <div className="flex flex-col gap-3"><h2 className="text-2xl font-semibold">Built for the Windows tray</h2><p className="leading-relaxed text-muted-foreground">Electron handles the tray icon and its context menu. A separate compact window keeps usage close without changing your dashboard.</p></div>
      </section>
    </main>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t py-8 text-sm text-muted-foreground">
      <p>Trackem · Independent of OpenAI and Anthropic.</p>
      <a href={repository + '/blob/main/SECURITY.md'} className="underline underline-offset-4">Security and privacy</a>
    </footer>
  </div>;
}

const container = document.getElementById('root');
if (!container) throw new Error('Website root is missing');
createRoot(container).render(<StrictMode><Website /></StrictMode>);
