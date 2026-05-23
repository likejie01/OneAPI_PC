import type { SubscriptionPlan } from '../shared/contracts'

type SubscriptionPlanBadge = {
  label: '月度套餐' | '年度套餐'
  tone: 'default' | 'annual'
}

function resolvePlanDurationDays(plan: Pick<SubscriptionPlan, 'duration_unit' | 'duration_value' | 'custom_seconds'>) {
  const value = Number(plan.duration_value || 0)

  switch (plan.duration_unit) {
    case 'year':
      return value * 365
    case 'month':
      return value * 30
    case 'day':
      return value
    case 'hour':
      return value / 24
    case 'custom':
      return Number(plan.custom_seconds || 0) / 86400
    default:
      return 0
  }
}

export function resolveSubscriptionPlanBadge(
  plan: Pick<SubscriptionPlan, 'duration_unit' | 'duration_value' | 'custom_seconds'>
): SubscriptionPlanBadge {
  const durationDays = resolvePlanDurationDays(plan)
  const isAnnual =
    plan.duration_unit === 'year' ||
    (plan.duration_unit === 'month' && Number(plan.duration_value || 0) >= 12) ||
    durationDays >= 365

  return isAnnual
    ? { label: '年度套餐', tone: 'annual' }
    : { label: '月度套餐', tone: 'default' }
}
