import dayjs from 'dayjs'

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

export function formatQuotaAsUsd(value?: number, quotaPerUnit = DEFAULT_QUOTA_PER_UNIT) {
  if (value === undefined || value === null) {
    return '--'
  }
  const usd = Number(value) / quotaPerUnit
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: usd >= 1 ? 2 : 4,
    maximumFractionDigits: usd >= 1 ? 2 : 4,
  }).format(usd)
}

export function clipText(value: string, max = 80) {
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max)}...`
}
