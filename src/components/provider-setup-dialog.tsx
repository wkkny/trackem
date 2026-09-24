import { useEffect, useState } from 'react';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { SiClaude } from 'react-icons/si';
import { LuCheck, LuSearch, LuTriangleAlert } from 'react-icons/lu';
import type { ConfigPayload, TrackemConfig, UsageSnapshot } from '@/types';
import { desktop, isDesktopApp } from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

type ProviderId = 'codex' | 'claude';
type SetupResult = { status: 'connected' | 'missing' | 'attention'; title: string; message: string };

const providers: { id: ProviderId; name: string; detail: string; icon: typeof AiOutlineOpenAI }[] = [
  { id: 'codex', name: 'Codex', detail: 'Find an existing Codex CLI login', icon: AiOutlineOpenAI },
  { id: 'claude', name: 'Claude Code', detail: 'Find an existing Claude Code login', icon: SiClaude },
];

function describeResult(provider: ProviderId, snapshots: UsageSnapshot[]): SetupResult {
  const name = provider === 'codex' ? 'Codex' : 'Claude Code';
  const connected = snapshots.filter(snapshot => snapshot.ok).length;
  if (connected > 0) {
    return {
      status: 'connected',
      title: `${name} is ready`,
      message: `Found ${connected} ${connected === 1 ? 'account' : 'accounts'}. Usage is ready to view.`,
    };
  }

  const missingLogin = snapshots.length > 0 && snapshots.every(snapshot => snapshot.error?.kind === 'missing-credential');
  if (missingLogin) {
    const loginCommand = provider === 'codex' ? 'codex login' : 'claude';
    return {
      status: 'missing',
      title: `No ${name} login found`,
      message: `Trackem checked the locations in your settings. Sign in with ${loginCommand}, then choose Check again.`,
    };
  }

  const message = snapshots.find(snapshot => !snapshot.ok)?.error?.message;
  return {
    status: 'attention',
    title: `${name} needs attention`,
    message: message ?? `Trackem could not find an installation in the configured locations. Check the provider settings and try again.`,
  };
}

export function ProviderSetupDialog({
  open,
  onOpenChange,
  config,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: TrackemConfig | null;
  onSaved: (payload: ConfigPayload) => void;
}) {
  const [currentConfig, setCurrentConfig] = useState(config);
  const [checking, setChecking] = useState<ProviderId | null>(null);
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    if (!open) {
      setChecking(null);
      setResult(null);
      return;
    }
    setCurrentConfig(config);
    setResult(null);
  }, [config, open]);

  const addProvider = async (provider: ProviderId) => {
    if (!currentConfig || !isDesktopApp() || checking) return;
    setChecking(provider);
    setResult(null);
    let savedConfig = currentConfig;

    try {
      const nextConfig: TrackemConfig = {
        ...currentConfig,
        [provider === 'codex' ? 'codexEnabled' : 'claudeEnabled']: true,
      };
      const payload = await desktop.setConfig(nextConfig);
      savedConfig = payload.config;
      setCurrentConfig(payload.config);
      onSaved(payload);
    } catch {
      setResult({
        status: 'attention',
        title: 'Could not add provider',
        message: 'Trackem could not save the provider settings. Check that preferences can be written, then try again.',
      });
      setChecking(null);
      return;
    }

    try {
      const usage = await desktop.getUsage();
      setResult(describeResult(provider, usage[provider]));
    } catch {
      setResult({
        status: 'attention',
        title: 'Provider added',
        message: 'Trackem saved the provider, but could not load its latest check. Refresh usage to try again.',
      });
      setCurrentConfig(savedConfig);
    } finally {
      setChecking(null);
    }
  };

  const close = (nextOpen: boolean) => {
    if (!nextOpen && checking) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a provider</DialogTitle>
          <DialogDescription>Choose a CLI. Trackem will save your choice and check for its existing local login.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y divide-border rounded-lg border bg-card px-3">
          {providers.map(provider => {
            const Icon = provider.icon;
            const alreadyAdded = currentConfig?.[provider.id === 'codex' ? 'codexEnabled' : 'claudeEnabled'] ?? false;
            const isChecking = checking === provider.id;
            return (
              <Button
                key={provider.id}
                type="button"
                variant="ghost"
                className="h-auto min-h-16 w-full justify-start gap-3 rounded-none px-1 py-3 text-left first:rounded-t-md last:rounded-b-md"
                onClick={() => void addProvider(provider.id)}
                disabled={!currentConfig || !isDesktopApp() || checking !== null}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted"><Icon size={18} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{provider.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{provider.detail}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {isChecking ? <Spinner aria-label={`Checking ${provider.name}`} /> : alreadyAdded ? 'Check again' : 'Add'}
                </span>
              </Button>
            );
          })}
        </div>

        {!currentConfig && <p className="text-sm text-muted-foreground">Loading provider settings…</p>}
        {!isDesktopApp() && <p className="text-sm text-muted-foreground">Provider setup is available in the Trackem desktop app.</p>}
        {checking && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LuSearch aria-hidden="true" /> Checking for an existing {checking === 'codex' ? 'Codex' : 'Claude Code'} login…
          </p>
        )}
        {result && (
          <div role="status" aria-live="polite" className="flex gap-3 rounded-lg border p-3">
            {result.status === 'connected' ? <LuCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : result.status === 'missing' ? <LuSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">{result.title}</p>
              <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{result.message}</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
