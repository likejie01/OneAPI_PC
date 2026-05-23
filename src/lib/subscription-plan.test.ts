import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSubscriptionPlanBadge } from './subscription-plan.ts'

test('resolveSubscriptionPlanBadge marks yearly plans with annual label and gold tone', () => {
  assert.deepEqual(
    resolveSubscriptionPlanBadge({
      duration_unit: 'year',
      duration_value: 1,
    }),
    {
      label: '年度套餐',
      tone: 'annual',
    }
  )
})

test('resolveSubscriptionPlanBadge treats 12 month plans as yearly', () => {
  assert.deepEqual(
    resolveSubscriptionPlanBadge({
      duration_unit: 'month',
      duration_value: 12,
    }),
    {
      label: '年度套餐',
      tone: 'annual',
    }
  )
})

test('resolveSubscriptionPlanBadge treats shorter plans as monthly', () => {
  assert.deepEqual(
    resolveSubscriptionPlanBadge({
      duration_unit: 'month',
      duration_value: 3,
    }),
    {
      label: '月度套餐',
      tone: 'default',
    }
  )
})
