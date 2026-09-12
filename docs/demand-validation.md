# Two-week developer pilot

The app includes tools for collecting feedback. Demand has not been validated yet.

## Recruit

Recruit 15 to 20 developers who personally pay for at least two AI coding tools. Start with Codex and Claude subscribers on Windows. Ask about the last time a quota interrupted their work, how often they check usage, and how they currently choose an account. Avoid recruiting only friends or people who already follow the project.

Invitation text:

> Do you pay for both Codex and Claude? I'm testing a Windows tray app that shows their subscription quotas and estimates when you might run out. I'd like you to use it during normal work for two weeks. It reads your existing CLI login locally, has no Trackem account, and uploads nothing. Could we spend 15 minutes on setup and another 15 minutes after the trial?

Explain that Claude's OAuth usage endpoint is not a guaranteed public API. Share the privacy section before installation. Use an installed Windows build so startup and notifications are part of the trial.

## Run the trial

1. Observe setup without guiding each click. Record whether both quotas appear and how long setup takes. Compare values and reset times with each provider's own usage page. Ask the user to check their credentials locally; never request token files or screenshots containing credentials.
2. Invite the participant to turn on the optional local study in Settings. Refusal is fine. All study data remains on their computer.
3. Let participants use the app for 14 days without daily reminders. Contact them once to resolve installation failures, recording that intervention separately.
4. On day 14, ask for the report from Early feedback after they review it. It contains relative active days, app opens, paid-tool count, usefulness, and monthly willingness to pay. Share through the channel used for recruitment. Trackem has no collection endpoint.
5. Interview participants who stopped using it as well as those who kept it. Ask what they did the last time they opened the app, whether a prediction changed their behavior, which numbers they trusted, and what they would remove.

Study day 0 begins on opt-in. Opens count only when the user opens the dashboard or tray, with a one-minute cooldown. Background refreshes and hidden login launches do not count. Active-day recording stops after day 89. Opting out deletes the file. Reports are self-selected, so report the number of recruited users, installs, opt-ins, returned reports, and interview responses separately.

## Decide before recruiting

Use these as initial decision thresholds, not evidence of success:

- At least 80% of participants connect both subscriptions without developer assistance.
- At least 50% of activated participants intentionally open Trackem on three distinct days during days 7 through 13.
- At least 40% describe a specific occasion where it helped them avoid a limit or choose an account.
- At least five participants agree to a paid follow-up at US$5/month. Survey answers alone do not count as payment evidence. Arrange a real paid pilot separately after explaining what will be delivered.

Count nonresponders in the recruited and activated denominators. Show both opt-in-report retention and interview-confirmed retention. Do not treat missing reports as verified usage or verified churn. Keep only the research notes participants agreed to share, and agree on a deletion date.

If setup fails, fix the adapters before adding providers. If activation succeeds but retention is weak, investigate whether notifications solve the need without app opens. If retention is good but people will not pay, test who benefits enough to purchase before building billing.
