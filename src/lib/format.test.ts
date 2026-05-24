import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPlainPrice,
  formatQuotaAsMillions,
  formatQuotaAsUsd,
  formatSubscriptionDuration,
  formatSubscriptionResetPeriod,
} from './format.ts'

test('formatQuotaAsUsd falls back to the default quota-per-unit when an invalid value is provided', () => {
  assert.equal(formatQuotaAsUsd(500_000, 0), '$1.00')
})

test('formatSubscriptionDuration formats builtin units and custom seconds', () => {
  assert.equal(formatSubscriptionDuration({ duration_unit: 'month', duration_value: 3 }), '3 个月')
  assert.equal(formatSubscriptionDuration({ duration_unit: 'custom', custom_seconds: 172_800 }), '2 天')
})

test('formatSubscriptionResetPeriod formats standard and custom reset cycles', () => {
  assert.equal(formatSubscriptionResetPeriod({ quota_reset_period: 'monthly' }), '每月重置')
  assert.equal(
    formatSubscriptionResetPeriod({ quota_reset_period: 'custom', quota_reset_custom_seconds: 7_200 }),
    '每 2 小时 重置'
  )
  assert.equal(formatSubscriptionResetPeriod({ quota_reset_period: 'never' }), '不重置')
})

test('formatQuotaAsMillions renders quota in million units', () => {
  assert.equal(formatQuotaAsMillions(80_000_000), '80.0M')
  assert.equal(formatQuotaAsMillions(1_250_000), '1.25M')
})

test('formatPlainPrice renders a numeric price label without the currency symbol', () => {
  assert.equal(formatPlainPrice(19.9), '19.90')
})
