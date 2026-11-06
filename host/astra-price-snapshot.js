/**
 * Community estimate snapshot matching Token Usage's model-price-table feed.
 * Source: https://github.com/LaoYueHanNi/model-price-table
 * Feed version 130 (RMB), updatedAt 1793784668; snapshot dated 2026-11-06.
 * These rates are estimates, not verified provider invoice amounts.
 * No network fetch or dependency on Token Usage's private storage at runtime.
 * A context threshold applies to the WHOLE request when input + cache read +
 * cache write reaches it, matching Token Usage's resolveTier semantics.
 */
export const ASTRA_PRICE_SOURCE = {
  feedVersion: 130,
  updatedAt: 1793784668,
  currency: 'CNY',
  basis: 'Token Usage community model-price-table snapshot; not actual gateway charges',
}

export const ASTRA_PRICE_ENTRY = {
  flat: true,
  peak: { input: 70, output: 350, cacheRead: 7, cacheWrite: 87.5 },
  contextTiers: [
    {
      threshold: 272_000,
      peak: { input: 140, output: 525, cacheRead: 14, cacheWrite: 175 },
    },
  ],
}
