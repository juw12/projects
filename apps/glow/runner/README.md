# GlowLead scheduled missions (free)

Runs GlowLead missions on a schedule using **GitHub Actions**, free on public repositories.
The runner opens the real GlowLead page in a hidden browser, so missions get the same planning,
research, review and honest "not checked live" warnings as the app, using Glow Free (no key needed).

## Set up (about 3 minutes)

1. In the repository go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Name it `GLOW_MISSIONS` and paste your list, for example:

   ```json
   {"missions": [
     {"name": "3D printer deals", "goal": "Find this week's best price for a Bambu Lab A1 mini in Indonesia, with sources.", "days": ["mon"]},
     {"name": "Morning brief", "goal": "Summarise today's top 3 maker and 3D printing news stories with links."}
   ]}
   ```
3. It runs every day at 00:00 UTC (07:00 Batam, 08:00 Taiwan). `days` limits a mission to certain
   UTC weekdays. To run now: **Actions → GlowLead scheduled missions → Run workflow** (you can type one goal).
4. Open a finished run: the summary table shows each mission, and the **glow-reports** artifact
   holds the full Markdown reports (kept 30 days).

## Privacy on a public repository

- The `GLOW_MISSIONS` secret stays private. `missions.json` in this folder is **public**; leave it empty
  for anything personal.
- The run summary (mission names, status) is public. Report artifacts can be downloaded by signed-in
  GitHub users. Do not schedule anything private on a public repository; use a private repository instead
  (2,000 free minutes per month).
- Optional: set the repository **variable** `GLOW_REPORT_ISSUE` to `true` to also post each report as a
  comment on a "GlowLead scheduled reports" issue, so GitHub notifies your phone. Those comments are public.

## Limits

- Glow Free is shared and rate-limited (about one AI reply per 30 s), so each mission takes several minutes.
- GitHub may delay scheduled runs at busy times, and disables schedules after 60 days without repository activity.
- No browser control (Glow Hands) or code execution: nobody is there to approve risky actions.
- AI review is a second look, not independent verification. Check important facts and links yourself.
