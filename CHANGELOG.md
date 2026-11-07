# Changelog

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
