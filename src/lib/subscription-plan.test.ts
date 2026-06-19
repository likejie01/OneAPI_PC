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
const polishStyles = readFileSync(resolve(repoRoot, 'styles', 'polish.css'), 'utf8')

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

test('subscription workspace hides plans that reached purchase limit after login', () => {
  assert.match(appSource, /function isSubscriptionPlanPurchaseLimitReached/)
  assert.match(appSource, /const visiblePlans = useMemo/)
  assert.match(appSource, /user && isSubscriptionPlanPurchaseLimitReached\(item\.plan, allSubscriptions\)/)
  assert.match(appSource, /visiblePlans\.map\(\(item\) =>/)
})

test('anonymous subscription workspace renders public cached or fallback plans without auth toast', () => {
  assert.match(appSource, /PUBLIC_SUBSCRIPTION_PLANS_CACHE_KEY/)
  assert.match(appSource, /PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS/)
  assert.match(appSource, /readPublicSubscriptionPlansCache/)
  assert.match(appSource, /loadPublicPlansForSubscriptionWorkspace/)
  assert.match(appSource, /!user \|\| isAuthRequiredErrorMessage\(message\)/)
  assert.match(appSource, /writePublicSubscriptionPlansCache\(enabledPlans\)/)
})

test('trial subscription plans are presented as recommended packages', () => {
  assert.match(appSource, /const isTrialPlan = isTrialSubscriptionPlan\(item\.plan\)/)
  assert.match(appSource, /const isRecommended = item\.plan\.id === recommendedPlanId \|\| isTrialPlan/)
  assert.doesNotMatch(appSource, />尝鲜</)
})

test('active subscription usage progress occupies half of the subscription card width', () => {
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?width:\s*50%/)
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?flex:\s*0 0 50%/)
  assert.match(modalsStyles, /\.subscription-record-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 50%\) !important/)
  assert.match(modalsStyles, /\.subscription-record-side \.subscription-progress-inline\s*\{[\s\S]*?width:\s*100% !important[\s\S]*?margin-left:\s*0 !important/)
  assert.doesNotMatch(modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?min-width:\s*180px !important/)
})

test('subscription workspace hides expired records and marks exhausted plans as invalid', () => {
  assert.match(appSource, /function isSubscriptionExpired\(subscription/)
  assert.match(appSource, /const visibleSubscriptionRecords = useMemo/)
  assert.match(appSource, /allSubscriptions\.filter\(\(item\) => !isSubscriptionExpired\(item\.subscription\)\)/)
  assert.match(appSource, /const exhausted = isSubscriptionExhausted\(item\.subscription\)/)
  assert.match(appSource, /className=\{`record-row subscription-record-row \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(appSource, /className=\{`subscription-progress-inline \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(appSource, /return '已失效'/)
  assert.match(appSource, /const usagePercentage = resolveBillingUsagePercentage\(item\)/)
  assert.match(appSource, /className=\{`billing-card \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(polishStyles, /\.subscription-progress-inline\.exhausted \.usage-bar-fill,[\s\S]*?\.billing-card\.exhausted \.billing-card-fill\s*\{[\s\S]*?background:\s*rgba\(136, 142, 150, 0\.72\) !important/)
})
