# FREYR

Trading research workspace built with Next.js and PostgreSQL. The application uses its existing Hyperliquid gold reference, Yahoo Finance reference feeds, and the Forex Factory weekly calendar.

## Scheduling

In-app monitoring checks open workspaces while the app is open. Signal read and write paths enforce the three-hour deadline regardless of monitor availability, preserving the original levels. For unattended monitoring and prediction publishing, configure `FREYR_CRON_SECRET` and have a trusted scheduler send `POST /api/maintenance` with `Authorization: Bearer <FREYR_CRON_SECRET>`. The endpoint is unavailable without configuration. Alerts are indicative observations, not broker executions. Browser notifications depend on browser permission and require Freyr to be open.

News records only directional calls issued before release. It checks a fixed two-hour reaction window using completed gold candles. Missing candles are not scored. The archive is not backfilled.

## Chart reviews

Screenshots are matched to the selected market and chart time for ModFlow and structure review. Review results and images can be stored in signed-in workspaces. Historical book snapshots are not substituted with current depth. Optional image-label reading uses `OPENAI_API_KEY` and, if desired, `FREYR_CHART_VISION_MODEL`. Images are sent to the provider only when the user selects that option; trading values always come from the market feed.

Set `FREYR_SUPPORT_EMAIL` to publish the real deployment operator’s contact on the legal and help pages. This version has no built-in checkout or refund processing.

## Development

Apply the Drizzle schema to PostgreSQL with `npx drizzle-kit push`, then build with `npm run build`. For pure signal and news rule checks, run `node --disable-warning=ExperimentalWarning --test tests/policies.mjs` on Node 22 or later.
