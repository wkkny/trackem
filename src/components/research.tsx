import { useCallback, useEffect, useState } from 'react';
import type { ResearchAnswers, ResearchReport } from '../types';
import { desktop, isDesktopApp } from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export function ResearchPage({ enabled, openSettings }: { enabled: boolean; openSettings: () => void }) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [answers, setAnswers] = useState<ResearchAnswers | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = useCallback((next: ResearchReport) => { setReport(next); setAnswers(next.answers); }, []);
  useEffect(() => {
    if (!enabled) return;
    if (isDesktopApp()) void desktop.getResearch().then(apply).catch(() => setMessage('Could not read local study data.'));
  }, [apply, enabled]);
  const run = async (action: 'save' | 'copy' | 'clear') => {
    if (!isDesktopApp() || !answers) return;
    setBusy(true); setMessage('');
    try {
      if (action === 'clear') apply(await desktop.clearResearch());
      else if (action === 'save') apply(await desktop.saveResearch(answers));
      else await desktop.copyResearch();
      setMessage(action === 'copy' ? 'Report copied. Share it with the person who invited you to try Trackem.' : action === 'clear' ? 'Study data deleted. Counting starts again on your next app open while enabled.' : 'Answers saved locally. Review the report below before copying.');
    } catch { setMessage('Could not complete this action. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className="flex max-w-2xl flex-col gap-6">
    <section className="flex flex-col gap-3"><h2 className="font-heading text-lg font-bold">Is Trackem worth keeping?</h2><p className="text-sm text-muted-foreground">We are testing whether developers paying for multiple AI tools return to Trackem and would pay for it. Try it during your normal work for two weeks, then share your experience with the person who invited you.</p><p className="text-sm text-muted-foreground">This study is optional and stays on your computer. It counts app opens and active days, not background polling. The report contains no account names, tokens, paths, prompts, or quota values. Copying puts it on your system clipboard; you choose whether to share it.</p></section>
    {!enabled ? <section className="flex flex-col gap-3"><p className="text-sm">The local study is off.</p><Button variant="outline" className="self-start" onClick={openSettings}>Open privacy settings</Button></section> : answers && <>
      <FieldGroup>
        <Field><FieldLabel htmlFor="paid-tools">How many AI coding tools do you pay for?</FieldLabel><NativeSelect id="paid-tools" value={answers.paidTools} disabled={busy} onChange={e => setAnswers({ ...answers, paidTools: e.target.value as ResearchAnswers['paidTools'] })}><NativeSelectOption value="unanswered">Prefer not to answer</NativeSelectOption><NativeSelectOption value="one">One</NativeSelectOption><NativeSelectOption value="two">Two</NativeSelectOption><NativeSelectOption value="three-plus">Three or more</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="useful">Has Trackem helped you avoid a limit or choose an account?</FieldLabel><NativeSelect id="useful" value={answers.useful} disabled={busy} onChange={e => setAnswers({ ...answers, useful: e.target.value as ResearchAnswers['useful'] })}><NativeSelectOption value="unanswered">Prefer not to answer</NativeSelectOption><NativeSelectOption value="yes">Yes</NativeSelectOption><NativeSelectOption value="no">No</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="would-pay">What would you pay monthly for Trackem?</FieldLabel><NativeSelect id="would-pay" value={answers.wouldPay} disabled={busy} onChange={e => setAnswers({ ...answers, wouldPay: e.target.value as ResearchAnswers['wouldPay'] })}><NativeSelectOption value="unanswered">Prefer not to answer</NativeSelectOption><NativeSelectOption value="no">I would not pay</NativeSelectOption><NativeSelectOption value="maybe">Unsure</NativeSelectOption><NativeSelectOption value="yes-3">US$3 per month</NativeSelectOption><NativeSelectOption value="yes-5">US$5 per month</NativeSelectOption><NativeSelectOption value="yes-10">US$10 per month</NativeSelectOption></NativeSelect></Field>
      </FieldGroup>
      <Button className="self-start" disabled={busy} onClick={() => void run('save')}>Save answers locally</Button>
      {report && <section className="flex flex-col gap-3"><h3 className="font-bold">Report preview</h3><p className="text-sm text-muted-foreground">{report.opens} opens on {report.activeDays.length} days. Day 0 is the first day of the study. Save edited answers to update this preview.</p><pre className="overflow-auto rounded-lg border p-4 text-xs">{JSON.stringify(report, null, 2)}</pre><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void run('copy')}>Copy this report</Button><Button variant="outline" disabled={busy} onClick={() => void run('clear')}>Delete study data</Button></div></section>}
    </>}
    <p role="status" className="text-sm">{message}</p>
  </div>;
}
