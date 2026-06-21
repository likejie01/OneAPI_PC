import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSubscriptionPlanBadge } from './subscription-plan.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSource = readFileSync(resolve(repoRoot, 'App.tsx'), 'utf8')
const accountWorkspaceSource = readFileSync(resolve(repoRoot, 'features', 'account', 'AccountWorkspaces.tsx'), 'utf8')
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
  assert.match(accountWorkspaceSource, /function isSubscriptionPlanPurchaseLimitReached/)
  assert.match(accountWorkspaceSource, /const visiblePlans = useMemo/)
  assert.match(accountWorkspaceSource, /user && isSubscriptionPlanPurchaseLimitReached\(item\.plan, allSubscriptions\)/)
  assert.match(accountWorkspaceSource, /visiblePlans\.map\(\(item\) =>/)
})

test('anonymous subscription workspace renders public cached or fallback plans without auth toast', () => {
  assert.match(accountWorkspaceSource, /PUBLIC_SUBSCRIPTION_PLANS_CACHE_KEY/)
  assert.match(accountWorkspaceSource, /PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS/)
  assert.match(accountWorkspaceSource, /readPublicSubscriptionPlansCache/)
  assert.match(accountWorkspaceSource, /loadPublicPlansForSubscriptionWorkspace/)
  assert.match(accountWorkspaceSource, /!user \|\| isAuthRequiredErrorMessage\(message\)/)
  assert.match(accountWorkspaceSource, /writePublicSubscriptionPlansCache\(enabledPlans\)/)
})

test('trial subscription plans are presented as recommended packages', () => {
  assert.match(accountWorkspaceSource, /const isTrialPlan = isTrialSubscriptionPlan\(item\.plan\)/)
  assert.match(accountWorkspaceSource, /const isRecommended = item\.plan\.id === recommendedPlanId \|\| isTrialPlan/)
  assert.doesNotMatch(accountWorkspaceSource, />尝鲜</)
})

test('active subscription usage progress occupies half of the subscription card width', () => {
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?width:\s*50%/)
  assert.match(workspaceStyles + modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?flex:\s*0 0 50%/)
  assert.match(modalsStyles, /\.subscription-record-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 50%\) !important/)
  assert.match(modalsStyles, /\.subscription-record-side \.subscription-progress-inline\s*\{[\s\S]*?width:\s*100% !important[\s\S]*?margin-left:\s*0 !important/)
  assert.doesNotMatch(modalsStyles, /\.subscription-progress-inline\s*\{[\s\S]*?min-width:\s*180px !important/)
})

test('subscription workspace hides expired records and marks exhausted plans as invalid', () => {
  assert.match(accountWorkspaceSource, /function isSubscriptionExpired\(subscription/)
  assert.match(accountWorkspaceSource, /const visibleSubscriptionRecords = useMemo/)
  assert.match(accountWorkspaceSource, /allSubscriptions\.filter\(\(item\) => !isSubscriptionExpired\(item\.subscription\)\)/)
  assert.match(accountWorkspaceSource, /const exhausted = isSubscriptionExhausted\(item\.subscription\)/)
  assert.match(accountWorkspaceSource, /className=\{`record-row subscription-record-row \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(accountWorkspaceSource, /className=\{`subscription-progress-inline \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(accountWorkspaceSource, /return '已失效'/)
  assert.match(accountWorkspaceSource, /const usagePercentage = resolveBillingUsagePercentage\(item\)/)
  assert.match(accountWorkspaceSource, /className=\{`billing-card \$\{exhausted \? 'exhausted' : ''\}`\}/)
  assert.match(polishStyles, /\.subscription-progress-inline\.exhausted \.usage-bar-fill,[\s\S]*?\.billing-card\.exhausted \.billing-card-fill\s*\{[\s\S]*?background:\s*rgba\(136, 142, 150, 0\.72\) !important/)
})
