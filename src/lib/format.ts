import dayjs from 'dayjs'
import type { SubscriptionPlan } from '../shared/contracts'

const DEFAULT_QUOTA_PER_UNIT = 500_000

export function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return '暂无'
  }
  const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  return dayjs(ms).format('YYYY-MM-DD HH:mm')
}

export function formatQuota(value?: number) {
  if (value === undefined || value === null) {
    return '0'
  }
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function formatPercent(value?: number) {
  if (value === undefined || value === null) {
    return '0%'
  }
  return `${(value * 100).toFixed(0)}%`
}

export function formatPrice(value?: number, currency = 'CNY') {
  if (value === undefined || value === null) {
    return '--'
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPlainPrice(value?: number) {
  if (value === undefined || value === null) {
    return '--'
  }
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatQuotaAsUsd(value?: number, quotaPerUnit = DEFAULT_QUOTA_PER_UNIT) {
  if (value === undefined || value === null) {
    return '--'
  }
  const resolvedQuotaPerUnit = quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
  const usd = Number(value) / resolvedQuotaPerUnit
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: usd >= 1 ? 2 : 4,
    maximumFractionDigits: usd >= 1 ? 2 : 4,
  }).format(usd)
}

function formatSecondsAsDuration(seconds: number) {
  if (seconds >= 86_400) {
    return `${Math.floor(seconds / 86_400)} 天`
  }
  if (seconds >= 3_600) {
    return `${Math.floor(seconds / 3_600)} 小时`
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)} 分钟`
  }
  return `${seconds} 秒`
}

export function formatSubscriptionDuration(plan: Partial<SubscriptionPlan>) {
  const unit = plan.duration_unit || 'month'
  const value = Number(plan.duration_value || 1)
  const unitLabels: Record<NonNullable<SubscriptionPlan['duration_unit']>, string> = {
    year: '年',
    month: '个月',
    day: '天',
    hour: '小时',
    custom: '秒',
  }

  if (unit === 'custom') {
    return formatSecondsAsDuration(Number(plan.custom_seconds || 0))
  }

  return `${value} ${unitLabels[unit] || unit}`
}

export function formatSubscriptionResetPeriod(plan: Partial<SubscriptionPlan>) {
  const period = plan.quota_reset_period || 'never'
  if (period === 'daily') {
    return '每天重置'
  }
  if (period === 'weekly') {
    return '每周重置'
  }
  if (period === 'monthly') {
    return '每月重置'
  }
  if (period === 'custom') {
    const seconds = Number(plan.quota_reset_custom_seconds || 0)
    return seconds > 0 ? `每 ${formatSecondsAsDuration(seconds)} 重置` : '自定义重置'
  }
  return '不重置'
}

export function formatQuotaAsMillions(value?: number) {
  if (value === undefined || value === null) {
    return '--'
  }
  const millions = Number(value) / 1_000_000
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: millions >= 100 ? 0 : millions >= 10 ? 1 : 2,
    maximumFractionDigits: millions >= 100 ? 0 : millions >= 10 ? 1 : 2,
  }).format(millions)}M`
}

export function clipText(value: string, max = 80) {
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max)}...`
}
