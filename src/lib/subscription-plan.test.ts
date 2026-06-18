import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSubscriptionPlanBadge } from './subscription-plan.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSource = readFileSync(resolve(repoRoot, 'App.tsx'), 'utf8')
const workspaceStyles = readFileSync(resolve(repoRoot, 'styles', 'workspace.css'), 'utf8')
const modalsStyles = readFileSync(resolve(repoRoot, 'styles', 'modals.css'), 'utf8')

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

test('subscription workspace hides trial plans after one purchase', () => {
  assert.match(appSource, /function isTrialSubscriptionPlan/)
  assert.match(appSource, /const visiblePlans = useMemo/)
  assert.match(appSource, /isTrialSubscriptionPlan\(item\.plan\) && countPlanPurchases\(allSubscriptions, item\.plan\.id\) > 0/)
  assert.match(appSource, /visiblePlans\.map\(\(item\) =>/)
})

test('trial subscription plans are presented as recommended packages', () => {
  assert.match(appSource, /const isTrialPlan = isTrialSubscriptionPlan\(item\.plan\)/)
  assert.match(appSource, /const isRecommended = item\.plan\.id === recommendedPlanId \|\| isTrialPlan/)
  assert.doesNotMatch(appSource, />尝鲜</)
})

test('active subscription usage progress occupies half of the subscription card width', () => {
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?width:\s*50%/)
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?flex:\s*0 0 50%/)
})
