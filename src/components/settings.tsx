import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConfigPayload, TrackemConfig } from '../types';
import { desktop, isDesktopApp } from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

type SettingsDialog = 'codex-profiles' | 'claude-directory' | 'reset-timing' | 'data-access' | null;

function Toggle({ id, label, checked, onChange, disabled = false, hint }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string | undefined;
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled} className="min-h-12 items-center justify-between py-2">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </Field>
  );
}

function ActionRow({ label, value, buttonLabel, onClick, disabled = false }: {
  label: string;
  value?: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {value && <p className="truncate text-xs text-muted-foreground">{value}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>{buttonLabel}</Button>
    </div>
  );
}

function SettingsGroup({ title, children, disabled }: { title: string; children: ReactNode; disabled: boolean }) {
  return (
    <FieldSet disabled={disabled} className="gap-2">
      <FieldLegend className="font-heading text-base font-bold">{title}</FieldLegend>
      <FieldGroup className="gap-0 divide-y divide-border rounded-lg border bg-card px-4">
        {children}
      </FieldGroup>
    </FieldSet>
  );
}

export function SettingsPage({ configPayload, onSaved, onAddProvider }: {
  configPayload: ConfigPayload | null;
  onSaved: (payload: ConfigPayload) => void;
  onAddProvider: (config: TrackemConfig) => void;
}) {
  const [draft, setDraft] = useState<TrackemConfig | null>(configPayload?.config ?? null);
  const [newHome, setNewHome] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<SettingsDialog>(null);

  useEffect(() => { if (configPayload) setDraft(configPayload.config); }, [configPayload]);

  if (!draft) return <p className="text-sm text-muted-foreground">Preferences are available in the desktop app.</p>;

  const change = <K extends keyof TrackemConfig>(key: K, value: TrackemConfig[K]) => {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setMessage('');
  };

  const addHome = () => {
    const home = newHome.trim();
    if (!home || draft.codexProfileHomes.includes(home) || draft.codexProfileHomes.length >= 20) return;
    change('codexProfileHomes', [...draft.codexProfileHomes, home]);
    setNewHome('');
  };

  const save = async () => {
    if (!isDesktopApp()) return;
    setSaving(true);
    setMessage('');
    try {
      onSaved(await desktop.setConfig(draft));
      setMessage('Preferences saved.');
    } catch {
      setMessage('Could not save preferences. Check file permissions and startup settings, then try again.');
    } finally {
      setSaving(false);
    }
  };

  const closeDialog = () => setDialog(null);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-8">
      <SettingsGroup title="Providers" disabled={saving}>
        {!draft.codexEnabled && !draft.claudeEnabled && <p className="py-3 text-sm text-muted-foreground">No providers added yet. Trackem only checks a provider after you add it.</p>}
        {draft.codexEnabled && <>
          <Toggle id="codex" label="Monitor Codex" checked={draft.codexEnabled} onChange={value => change('codexEnabled', value)} />
          <ActionRow
            label="Additional Codex profiles"
            value={draft.codexProfileHomes.length ? `${draft.codexProfileHomes.length} added` : 'Default profile included'}
            buttonLabel={draft.codexProfileHomes.length ? 'Manage' : 'Add'}
            onClick={() => setDialog('codex-profiles')}
            disabled={saving}
          />
        </>}
        {draft.claudeEnabled && <>
          <Toggle id="claude" label="Monitor Claude Code" checked={draft.claudeEnabled} onChange={value => change('claudeEnabled', value)} />
          <ActionRow
            label="Claude Code directory"
            value={draft.claudeHome.trim() ? 'Custom directory' : 'Default CLI directory'}
            buttonLabel={draft.claudeHome.trim() ? 'Edit' : 'Set'}
            onClick={() => setDialog('claude-directory')}
            disabled={saving}
          />
        </>}
        {(draft.codexEnabled || draft.scanLocalModels) && <Toggle
            id="models"
            label="Read local Codex model stats"
            checked={draft.scanLocalModels}
            onChange={value => change('scanLocalModels', value)}
            hint="Reads local session files. Prompt contents are not retained."
          />}
        <ActionRow
          label={draft.codexEnabled || draft.claudeEnabled ? 'Add another provider' : 'Add a provider'}
          value="Check for an existing CLI login on this device"
          buttonLabel="Add"
          onClick={() => onAddProvider(draft)}
          disabled={saving || !isDesktopApp()}
        />
      </SettingsGroup>

      <SettingsGroup title="Notifications" disabled={saving}>
        <Toggle id="low-usage" label="Quota warnings" checked={draft.notifyOnLowUsage} onChange={value => change('notifyOnLowUsage', value)} />
        <Toggle id="reset-expiry" label="Banked reset warnings" checked={draft.notifyOnResetExpiry} onChange={value => change('notifyOnResetExpiry', value)} />
        <ActionRow
          label="Reset warning timing"
          value={`${draft.resetExpiryDays} days before expiry`}
          buttonLabel="Adjust"
          onClick={() => setDialog('reset-timing')}
          disabled={saving}
        />
      </SettingsGroup>

      <SettingsGroup title="App behavior" disabled={saving}>
        <Toggle
          id="startup"
          label="Launch at login"
          checked={draft.launchAtLogin}
          onChange={value => change('launchAtLogin', value)}
          disabled={saving || !configPayload?.startupSupported}
          hint={configPayload && !configPayload.startupSupported ? 'Available in the installed app.' : undefined}
        />
        <Toggle
          id="research"
          label="Keep a local usage study"
          checked={draft.localResearch}
          onChange={value => change('localResearch', value)}
          hint="Turning this off deletes saved study data."
        />
        <ActionRow label="Data access and privacy" buttonLabel="Details" onClick={() => setDialog('data-access')} disabled={saving} />
      </SettingsGroup>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p role="status" className="text-sm text-muted-foreground">{message}</p>
        <Button className="ml-auto" onClick={() => void save()} disabled={saving || !isDesktopApp()}>
          {saving && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </footer>

      <Dialog open={dialog !== null} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-xl">
          {dialog === 'codex-profiles' && (
            <>
              <DialogHeader>
                <DialogTitle>Codex profiles</DialogTitle>
                <DialogDescription>The default Codex profile is included automatically. Add up to 20 more directories containing an auth.json file.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                {draft.codexProfileHomes.length > 0 && (
                  <div className="flex flex-col divide-y divide-border rounded-lg border px-3">
                    {draft.codexProfileHomes.map(home => (
                      <div key={home} className="flex min-w-0 items-center justify-between gap-3 py-2">
                        <code className="min-w-0 flex-1 break-all text-xs">{home}</code>
                        <Button type="button" variant="ghost" size="sm" onClick={() => change('codexProfileHomes', draft.codexProfileHomes.filter(item => item !== home))} aria-label={`Remove ${home}`}>Remove</Button>
                      </div>
                    ))}
                  </div>
                )}
                <Field>
                  <FieldLabel htmlFor="codex-home">Profile directory</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="codex-home"
                      value={newHome}
                      onChange={event => setNewHome(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addHome(); } }}
                      placeholder="~/.codex-work"
                      disabled={draft.codexProfileHomes.length >= 20}
                    />
                    <Button type="button" variant="outline" onClick={addHome} disabled={!newHome.trim() || draft.codexProfileHomes.length >= 20}>Add</Button>
                  </div>
                  <FieldDescription>Changes are saved when you select Save changes on the settings page.</FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>Done</Button></DialogFooter>
            </>
          )}

          {dialog === 'claude-directory' && (
            <>
              <DialogHeader>
                <DialogTitle>Claude directory</DialogTitle>
                <DialogDescription>Choose where Trackem looks for the existing Claude Code login.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="claude-home">Directory</FieldLabel>
                  <Input id="claude-home" value={draft.claudeHome} onChange={event => change('claudeHome', event.target.value)} placeholder="Leave blank to use the default" />
                  <FieldDescription>Leave blank for CLAUDE_CONFIG_DIR or ~/.claude. For WSL, use a Windows-accessible path such as \\wsl.localhost\Ubuntu\home\you\.claude.</FieldDescription>
                </Field>
                <FieldDescription>Changes are saved when you select Save changes on the settings page.</FieldDescription>
              </FieldGroup>
              <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>Done</Button></DialogFooter>
            </>
          )}

          {dialog === 'reset-timing' && (
            <>
              <DialogHeader>
                <DialogTitle>Reset warning timing</DialogTitle>
                <DialogDescription>Choose how many days before a banked Codex reset expires to show a notification.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="reset-days">Days before expiry</FieldLabel>
                  <Input id="reset-days" type="number" min={1} max={30} value={draft.resetExpiryDays} onChange={event => change('resetExpiryDays', Number(event.target.value))} />
                  <FieldDescription>Choose between 1 and 30 days. Changes are saved on the settings page.</FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>Done</Button></DialogFooter>
            </>
          )}

          {dialog === 'data-access' && (
            <>
              <DialogHeader>
                <DialogTitle>Data access and privacy</DialogTitle>
                <DialogDescription>Trackem reads existing command-line logins only for providers you add, to show provider-reported subscription quotas.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>OAuth tokens stay in the Rust app process and are sent only to their provider over HTTPS. Trackem never sends tokens to this interface, logs, or preferences, and never refreshes or rewrites credentials.</p>
                <ul className="ml-5 flex list-disc flex-col gap-2">
                  <li>Codex: auth.json in CODEX_HOME or ~/.codex, plus profiles you add here.</li>
                  <li>Claude: .credentials.json in CLAUDE_CONFIG_DIR or ~/.claude. The default macOS setup may use the Claude Code Keychain entry.</li>
                  <li>Optional model scanning reads local Codex session files, which may contain prompts. It keeps model statistics only and is off by default.</li>
                  <li>Preferences and optional study data stay in the app data directory. Trackem has no backend or automatic telemetry.</li>
                </ul>
                <p className="break-all text-xs">Preferences file: <code>{configPayload?.file}</code></p>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>Done</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
