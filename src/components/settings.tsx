import { useEffect, useState } from 'react';
import type { ConfigPayload, TrackemConfig } from '../types';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';

function Toggle({ id, label, description, checked, onChange, disabled = false }: { id: string; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <Field orientation="horizontal" data-disabled={disabled}><FieldContent><FieldLabel htmlFor={id}>{label}</FieldLabel><FieldDescription id={`${id}-help`}>{description}</FieldDescription></FieldContent><Switch id={id} aria-describedby={`${id}-help`} checked={checked} onCheckedChange={onChange} disabled={disabled} /></Field>;
}

export function SettingsPage({ configPayload, onSaved }: { configPayload: ConfigPayload | null; onSaved: (payload: ConfigPayload) => void }) {
  const [draft, setDraft] = useState<TrackemConfig | null>(configPayload?.config ?? null);
  const [newHome, setNewHome] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (configPayload) setDraft(configPayload.config); }, [configPayload]);
  if (!draft) return <p className="text-sm text-muted-foreground">Preferences are available in the desktop app.</p>;
  const change = <K extends keyof TrackemConfig>(key: K, value: TrackemConfig[K]) => { setDraft({ ...draft, [key]: value }); setMessage(''); };
  const addHome = () => {
    const home = newHome.trim();
    if (!home || draft.codexProfileHomes.includes(home) || draft.codexProfileHomes.length >= 20) return;
    change('codexProfileHomes', [...draft.codexProfileHomes, home]); setNewHome('');
  };
  const save = async () => {
    if (!window.trackem) return;
    setSaving(true); setMessage('');
    try { onSaved(await window.trackem.setConfig(draft)); setMessage('Preferences saved.'); }
    catch { setMessage('Could not save all preferences. Check file permissions and startup settings, then try again.'); }
    finally { setSaving(false); }
  };
  return <div className="flex flex-col gap-8">
    <section className="flex flex-col gap-3"><h2 className="font-heading text-lg font-bold">What Trackem accesses</h2>
      <p className="text-sm text-muted-foreground">Trackem reads existing CLI OAuth credentials in its main process and sends the access token only to that provider over HTTPS. Tokens never enter this interface, preferences, feedback reports, or logs. Trackem does not refresh or rewrite credentials.</p>
      <ul className="ml-5 flex list-disc flex-col gap-2 text-sm text-muted-foreground">
        <li>Codex: <code>auth.json</code> under <code>CODEX_HOME</code> or <code>~/.codex</code> and added profiles. Requests go to <code>chatgpt.com/backend-api/wham/usage</code> and <code>rate-limit-reset-credits</code>.</li>
        <li>Claude: <code>.credentials.json</code> under <code>CLAUDE_CONFIG_DIR</code> or <code>~/.claude</code>. On macOS, the default profile can use the <code>Claude Code-credentials</code> Keychain entry. Requests go to <code>api.anthropic.com/api/oauth/usage</code>.</li>
        <li>Quota observations stay in memory for up to two hours. Closing Trackem clears them. No browser cookies, project files, or chat history are read unless you enable the optional Codex model scan below.</li>
        <li>No Trackem server or telemetry. Preferences and optional study data stay in the application data directory. Your OS protects the CLI credential files; Trackem does not copy them.</li>
      </ul>
    </section>
    <FieldSet disabled={saving}><FieldLegend>Provider access</FieldLegend><FieldGroup>
      <Toggle id="codex" label="Monitor Codex" description="Read Codex OAuth logins and fetch subscription quota windows." checked={draft.codexEnabled} onChange={value => change('codexEnabled', value)} />
      <Toggle id="claude" label="Monitor Claude" description="Read the Claude Code OAuth login and fetch subscription quotas." checked={draft.claudeEnabled} onChange={value => change('claudeEnabled', value)} />
      <Field><FieldLabel htmlFor="claude-home">Claude directory</FieldLabel><Input id="claude-home" value={draft.claudeHome} onChange={e => change('claudeHome', e.target.value)} placeholder="Leave blank for the default CLI directory" /><FieldDescription>For WSL, enter a Windows-accessible directory such as <code>\\wsl.localhost\Ubuntu\home\you\.claude</code>. Credentials stay in that directory.</FieldDescription></Field>
      <Toggle id="models" label="Read local Codex model statistics" description="Optional. Reads recent Codex session logs, which can contain prompts, to count model usage locally. Off by default. No log contents are sent anywhere." checked={draft.scanLocalModels} onChange={value => change('scanLocalModels', value)} />
    </FieldGroup></FieldSet>
    <FieldSet disabled={saving}><FieldLegend>Additional Codex profiles</FieldLegend><FieldDescription>The default CLI directory is included when Codex monitoring is on. Add up to 20 more directories containing auth.json.</FieldDescription><FieldGroup>
      {draft.codexProfileHomes.map(home => <Field key={home} orientation="horizontal"><code className="min-w-0 flex-1 break-all text-xs">{home}</code><Button variant="outline" size="sm" onClick={() => change('codexProfileHomes', draft.codexProfileHomes.filter(item => item !== home))} aria-label={`Remove ${home}`}>Remove</Button></Field>)}
      <Field><FieldLabel htmlFor="codex-home">Profile directory</FieldLabel><Input id="codex-home" value={newHome} onChange={e => setNewHome(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHome(); } }} placeholder="~/.codex-work" /><Button variant="outline" className="self-start" onClick={addHome} disabled={!newHome.trim() || draft.codexProfileHomes.length >= 20}>Add profile</Button></Field>
    </FieldGroup></FieldSet>
    <FieldSet disabled={saving}><FieldLegend>Desktop behavior</FieldLegend><FieldGroup>
      <Toggle id="startup" label="Launch at login" description={configPayload?.startupSupported ? 'Start hidden in the tray when you sign in to your computer.' : 'Available in installed Windows and macOS builds.'} disabled={!configPayload?.startupSupported} checked={draft.launchAtLogin} onChange={value => change('launchAtLogin', value)} />
      <Toggle id="low-usage" label="Quota warnings" description="Notify at 10% remaining or when the recent pace predicts exhaustion within an hour. At most once per account and quota window per app session. Notifications omit account names." checked={draft.notifyOnLowUsage} onChange={value => change('notifyOnLowUsage', value)} />
      <Toggle id="reset-expiry" label="Reset expiry warnings" description="Notify before a banked Codex reset expires." checked={draft.notifyOnResetExpiry} onChange={value => change('notifyOnResetExpiry', value)} />
      <Field><FieldLabel htmlFor="reset-days">Days before reset expiry</FieldLabel><Input id="reset-days" type="number" min={1} max={30} className="max-w-24" value={draft.resetExpiryDays} onChange={e => change('resetExpiryDays', Number(e.target.value))} /></Field>
    </FieldGroup></FieldSet>
    <FieldSet disabled={saving}><FieldLegend>Early feedback</FieldLegend><FieldGroup><Toggle id="research" label="Keep a local usage study" description="Off by default. Count intentional app opens and active days for 90 days, and optionally answer whether you would pay. Nothing is uploaded. Turning this off deletes study data. Review or copy a report in Early feedback." checked={draft.localResearch} onChange={value => change('localResearch', value)} /></FieldGroup></FieldSet>
    <footer className="flex flex-col gap-3 border-t pt-4"><p className="break-all text-xs text-muted-foreground">Preferences: {configPayload?.file}</p><p role="status" className="text-sm">{message}</p><Button className="self-start" onClick={() => void save()} disabled={saving}>{saving && <Spinner data-icon="inline-start" />}Save changes</Button></footer>
  </div>;
}
