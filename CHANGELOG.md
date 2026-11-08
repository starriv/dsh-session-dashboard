# Changelog

## 1.3.0

- Session ranking now shows **two duration columns** instead of one:
  - 「活跃时长」/“Active time” is the new metric. It merges the session's own
    events into activity intervals and excludes idle gaps longer than
    `idleGapMinutes` (default 10 minutes, range 1–120). A conversation left open
    for a week no longer reports 100+ hours of active work.
  - 「总时长」/“Total time” keeps the previous wall-clock span, but ends at the
    session's last real activity instead of the last log line. A trailing
    `session/end-seed` marker written hours or days later no longer turns a
    1.7h session into 266h, so the old number stays available without the false
    tail.
- The ranking's duration sort uses active time, then total time, then spend as
  tie breakers (identical on Host and Client); the segmented control is renamed
  to 「按活跃时长」/“By active time”.
- Scoped snapshots (7/14/30 days) clip both metrics to the selected window, so a
  7-day view cannot report a longer duration than the window itself. Isolated
  single-event stretches keep their instant in the scoped first/last bounds
  even though they contribute zero active duration.
- Tooltips on both columns explain the formula and show the first/last activity
  instants plus the merged activity span (active) or the session span (total).
- Seed-inherited prefixes and `session/end-seed` markers never contribute
  activity; out-of-order and corrupt event clocks are ignored safely.
- Add store, parser helper, SSR and formatting tests for both metrics.

## 1.2.0

- Publish the bundle as `dsh-session-dashboard` on the npm registry so DSH can
  track versions and offer the **Update** action in the Plugins page.
- Add the npm distribution metadata and publish workflow inputs needed for
  registry installs; local path/link installs remain development-only and do
  not receive update badges.
- Keep the existing bundle row id and dashboard configuration compatible with
  previous local installations.

## 1.1.0

- Add a built-in GPT-6 Astra price snapshot from the community model-price-table
  v130 feed: flat all-day rates and whole-request context tiers at 272k
  input-side tokens.
- Preserve provider/model override precedence, `null` disablement, cache-write
  pricing and legacy DeepSeek peak/idle behavior.
- Update cost labels and documentation to describe model-price estimates rather
  than only DeepSeek list prices.
- Add 20 regression tests for tier boundaries, fold integration, overrides and
  legacy compatibility. (`#1`)

## 1.0.0

- Sidebar **Session Stats** panel for the DSH Web GUI.
- KPI strip with previous-period context, daily token trend with previous-period
  line, token composition, session ranking, and DSH runtime health.
- Exact reconciliation with the official `tokenUsage` projection, fork seed
  handling, retry replacement and peak/idle pricing.
- Bounded zstd/multi-frame decoding, per-file skip reporting, duplicate-session
  folding, strict scope parsing and fail-closed authenticated snapshot.
- Component-level high-precision loading skeletons, light/dark themes, mobile
  layout, accessible chart navigation and keyboard/error-state recovery.
