# Changelog

## 1.4.1

- Fix the built-in `deepseek-v4-pro` **peak output** price: 13.5 → 27.0 CNY per
  million tokens. 13.5 is the official *off-peak* output rate, so every pro
  output token was charged at exactly half the official price at both tiers
  (idle output 6.75 → 13.5). Flash rates, the peak/idle rule and the Astra
  snapshot were already correct. Source: the official 2026-11-10 DeepSeek
  pricing page, cross-checked against the pinned community price feed v130.
- Count provider-reported `compaction/summary` usage. Context compaction is a
  separate billed model request, and its usage was previously ignored: on the
  current corpus that under-reported tokens/cost by ~0.06%/0.07% (7 calls in 6
  sessions). It is now priced at the call's own timestamp/model, deduplicated by
  `compactionId`, and never enters the `(turn, step)` replacement slot. The
  official `tokenUsage` projection does not include compaction, so affected
  sessions may now exceed that projection slightly.
- Document the estimate's scope in the README: peak windows are Beijing time
  and PRC statutory holidays are not modeled (the deviation is an overcharge,
  never an undercharge); Search/Fetch per-successful-request fees, title
  generation and in-session web-search model calls, interrupted requests and
  usage from other clients on the same account are not part of the estimate.
- Tests: update the pro price assertions, add a built-in-table regression test
  and a compaction-fold test (single bill per `compactionId`, slot isolation).
  The real-log reconciliation test now treats forked sessions explicitly: their
  durable log repeats the inherited prefix that the official projection counts,
  while the dashboard cuts it at the seed marker, so a seeded row may only be
  lower than that projection.

## 1.4.0

- The range selector now includes 「今日」/“Today”: one click turns the KPI
  strip, daily chart, token composition and session ranking into a view of the
  current local day (00:00 to now). Its comparison period is yesterday.
- Calendar days follow the **user's browser time zone**, not the Host's. The
  client sends its IANA zone (`tz`) with every snapshot request, and the Host
  buckets days, scopes and previous-period windows in that zone. The configured
  `timeZone` remains the fallback when no browser zone is supplied (for example
  a non-browser client) and still decides the peak/idle pricing windows.
- All ranges use the same user-zone calendar, so switching between 今日, 7/14/30
  days and all-time cannot shift a session across day buckets. When the display
  zone changes, the Host re-parses the corpus for the new zone and serializes
  zone switches so one snapshot never mixes two calendars. Zones that produce
  identical day boundaries (for example two UTC+8 zones) are relabelled without
  a re-parse, and the previous calendar is kept as a single alternate corpus so
  two browser zones polling in turn do not re-read the logs per request. Invalid
  zones fall back to the configured zone instead of failing the request.
- Whole-corpus rebuilds caused by switching between incompatible display
  calendars are throttled by `zoneRebuildMs` (default 30 s, `0` disables).
  Requests made inside that window keep the current calendar and report it in
  the response's `timeZone`; two alternating calendars are served from the
  spare corpus and never wait.
- The KPI baseline for scoped views (7/14/30/today) now starts at the selected
  window instead of the first session ever recorded, so the "since" context can
  no longer predate the window; all-time views keep the historical start date.
- Add Host/client tests for zone rebucketing and throttling, `scope=1` today
  snapshots, scoped baselines, invalid `tz` fallback, the browser-zone request
  parameter and the 今日 card label.

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
