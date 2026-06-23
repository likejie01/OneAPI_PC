import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, Sparkles, X } from 'lucide-react'
import dayjs from 'dayjs'
import { getAuthStatus, unwrapEnvelope } from '../../domains/auth'
import { getSelfProfile } from '../../domains/profile'
import { getPublicPlans, getSelfSubscriptions, getSubscriptionPaymentInfo, paySubscription } from '../../domains/subscriptions'
import { createAlipayTopupOrder, getBillingHistory, getTopupInfo, queryAlipayTopupOrder, redeemTopupCode } from '../../domains/wallet'
import { getPerfMetricsSummary, getUserUsageLogs } from '../../domains/usage'
import { getServiceStatusSnapshot } from '../../domains/service-status'
import { formatDateTime, formatPlainPrice, formatPrice, formatQuota, formatQuotaAsMillions, formatQuotaAsUsd, formatSubscriptionDuration, formatSubscriptionResetPeriod } from '../../lib/format'
import { resolveSubscriptionPlanBadge } from '../../lib/subscription-plan'
import { readJsonStorage, writeJsonStorage } from '../../lib/storage'
import type { ServiceStatusCacheStore, ServiceStatusItem } from '../../lib/service-status'
import type { BillingHistoryData, PlanRecord, SubscriptionPaymentInfo, SubscriptionSelfData, TopupInfo, UsageData, UserProfile } from '../../shared/contracts'

const SERVICE_STATUS_CACHE_KEY = 'oneapi-desktop-service-status'
const PUBLIC_SUBSCRIPTION_PLANS_CACHE_KEY = 'oneapi-desktop-public-subscription-plans'
const SERVICE_STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS: PlanRecord[] = [
  {
    plan: {
      id: -101,
      title: '推荐套餐',
      subtitle: '适合桌面端日常 AIChat、Codex 与 Claude 工作流。',
      price_amount: 29.9,
      currency: 'CNY',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'monthly',
      total_amount: 15_000_000,
      enabled: true,
      sort_order: 30,
      max_purchase_per_user: 0,
    },
  },
  {
    plan: {
      id: -102,
      title: '专业套餐',
      subtitle: '适合高频开发、长上下文任务和多端协作。',
      price_amount: 99,
      currency: 'CNY',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'monthly',
      total_amount: 60_000_000,
      enabled: true,
      sort_order: 20,
      max_purchase_per_user: 0,
    },
  },
]
const REDEEM_CODE_PURCHASE_URL = 'https://oneapi.taobao.com/'
type TopupPaymentMethod = TopupInfo['pay_methods'][number]

function getDesktopBridge() {
  return window.desktopBridge
}

function getAlipayTopupMethods(topupInfo: TopupInfo | null): TopupPaymentMethod[] {
  if (!topupInfo?.enable_alipay_topup) {
    return []
  }

  const methods = (topupInfo?.pay_methods || [])
    .filter((item) => item.type?.trim().toLowerCase() === 'alipay')
    .map((item) => ({
      ...item,
      name: item.name?.trim() || '支付宝',
      type: 'alipay',
    }))

  if (methods.length) {
    return methods
  }

  return [
    {
      name: '支付宝',
      type: 'alipay',
      min_topup: topupInfo.min_topup,
    },
  ]
}

function formatExpiresIn(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '以服务端订单为准'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  if (hours > 0) {
    return `${hours} 小时`
  }
  return `${Math.max(1, minutes)} 分钟`
}

function isAuthRequiredErrorMessage(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('unauthorized') ||
    normalized.includes('未登录') ||
    normalized.includes('no auth') ||
    normalized.includes('invalid access token') ||
    normalized.includes('access token')
  )
}

function resolveUsageTimestamp(item: UsageData['items'][number]) {
  const raw = Number(item.created_at || item.created_time || 0)
  if (!raw) {
    return 0
  }
  return raw > 10_000_000_000 ? raw : raw * 1000
}

function EmptyState(props: { title: string; description: string; icon?: typeof Sparkles }) {
  const { title, description, icon: Icon = Sparkles } = props
  return (
    <div className='empty-card'>
      <Icon size={20} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

function readServiceStatusCache() {
  return readJsonStorage<ServiceStatusCacheStore>(SERVICE_STATUS_CACHE_KEY, {
    items: [],
    refreshedAt: 0,
    mode: 'status-page',
  })
}

function writeServiceStatusCache(value: ServiceStatusCacheStore) {
  writeJsonStorage(SERVICE_STATUS_CACHE_KEY, value)
}

function readPublicSubscriptionPlansCache() {
  return readJsonStorage<PlanRecord[]>(PUBLIC_SUBSCRIPTION_PLANS_CACHE_KEY, [])
}

function writePublicSubscriptionPlansCache(value: PlanRecord[]) {
  writeJsonStorage(PUBLIC_SUBSCRIPTION_PLANS_CACHE_KEY, value)
}

function countPlanPurchases(records: SubscriptionSelfData['all_subscriptions'], planId: number) {
  return records.filter((item) => item.subscription.plan_id === planId).length
}


function isTrialSubscriptionPlan(plan: PlanRecord['plan']) {
  const title = `${plan.title || ''} ${plan.subtitle || ''}`.toLowerCase()
  const purchaseLimit = Number(plan.max_purchase_per_user || 0)
  const priceAmount = Number(plan.price_amount || 0)
  return title.includes('尝鲜') || title.includes('trial') || (purchaseLimit === 1 && priceAmount <= 1)
}

function isSubscriptionPlanPurchaseLimitReached(
  plan: PlanRecord['plan'],
  records: SubscriptionSelfData['all_subscriptions']
) {
  const purchaseLimit = Number(plan.max_purchase_per_user || 0)
  return purchaseLimit > 0 && countPlanPurchases(records, plan.id) >= purchaseLimit
}

function isSubscriptionExhausted(subscription: SubscriptionSelfData['all_subscriptions'][number]['subscription']) {
  const total = Number(subscription.amount_total || 0)
  const used = Number(subscription.amount_used || 0)
  return total > 0 && used >= total
}

function isSubscriptionExpired(subscription: SubscriptionSelfData['all_subscriptions'][number]['subscription']) {
  const status = String(subscription.status || '').toLowerCase()
  if (status === 'expired') {
    return true
  }
  const endTime = Number(subscription.end_time || 0)
  return endTime > 0 && endTime * 1000 < Date.now()
}

function resolveSubscriptionStatusLabel(subscription: SubscriptionSelfData['all_subscriptions'][number]['subscription']) {
  if (isSubscriptionExhausted(subscription)) {
    return '已失效'
  }
  const status = String(subscription.status || '').toLowerCase()
  switch (String(status || '').toLowerCase()) {
    case 'active':
      return '生效中'
    case 'expired':
      return '已过期'
    case 'cancelled':
      return '已取消'
    default:
      return subscription.status || '未知状态'
  }
}

function resolveRecommendedSubscriptionPlanId(plans: PlanRecord[]) {
  const candidates = plans
    .map((item) => {
      const price = Number(item.plan.price_amount || 0)
      const totalAmount = Number(item.plan.total_amount || 0)
      if (price <= 0 || totalAmount <= 0) {
        return null
      }
      return {
        id: item.plan.id,
        valueScore: totalAmount / price,
        totalAmount,
        price,
      }
    })
    .filter((item): item is { id: number; valueScore: number; totalAmount: number; price: number } => Boolean(item))
    .sort((left, right) => {
      if (right.valueScore !== left.valueScore) {
        return right.valueScore - left.valueScore
      }
      if (right.totalAmount !== left.totalAmount) {
        return right.totalAmount - left.totalAmount
      }
      return left.price - right.price
    })

  return candidates[0]?.id ?? 0
}


function percentageOf(value: number, total: number) {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, (value / total) * 100))
}

function usageModelSummary(items: UsageData['items']) {
  const summary = new Map<
    string,
    {
      model: string
      quota: number
      count: number
      promptTokens: number
      completionTokens: number
      lastAt: number
    }
  >()

  for (const item of items) {
    const model = item.model_name || item.token_name || '未标注模型'
    const current = summary.get(model) ?? {
      model,
      quota: 0,
      count: 0,
      promptTokens: 0,
      completionTokens: 0,
      lastAt: 0,
    }

    current.quota += Number(item.quota || 0)
    current.count += 1
    current.promptTokens += Number(item.prompt_tokens || 0)
    current.completionTokens += Number(item.completion_tokens || 0)
    current.lastAt = Math.max(current.lastAt, Number(item.created_at || item.created_time || 0))
    summary.set(model, current)
  }

  return Array.from(summary.values()).sort((left, right) => right.quota - left.quota)
}

const USAGE_CHART_COLORS = [
  '#1d6b78',
  '#c96e4b',
  '#356f9c',
  '#6f7d4e',
  '#8d5bb3',
  '#2a9fa7',
  '#cc8f2b',
  '#54708c',
]
const USAGE_TREND_WINDOW_MS = 2 * 60 * 60 * 1000
const USAGE_TREND_BUCKET_MS = 5 * 60 * 1000

function clampChartCoordinate(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function buildSmoothLinePath(points: Array<{ x: number; y: number }>, minY?: number, maxY?: number) {
  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  const [first, ...rest] = points
  let path = `M ${first.x} ${first.y}`

  for (let index = 0; index < rest.length; index += 1) {
    const previous = points[index]
    const current = rest[index]
    const midX = (previous.x + current.x) / 2
    const controlY1 = typeof minY === 'number' && typeof maxY === 'number'
      ? clampChartCoordinate(previous.y, minY, maxY)
      : previous.y
    const controlY2 = typeof minY === 'number' && typeof maxY === 'number'
      ? clampChartCoordinate(current.y, minY, maxY)
      : current.y
    path += ` C ${midX} ${controlY1} ${midX} ${controlY2} ${current.x} ${current.y}`
  }

  return path
}

function resolveUsageTimelineBounds(items: UsageData['items']) {
  const timestamps = items
    .map((item) => resolveUsageTimestamp(item))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
  const latest = timestamps.at(-1) || Date.now()
  const earliest = timestamps[0] || latest
  const latestWindowStart = Math.max(0, latest - USAGE_TREND_WINDOW_MS)
  const earliestWindowStart = Math.max(0, Math.min(earliest, latestWindowStart))
  return {
    earliest,
    latest,
    earliestWindowStart,
    latestWindowStart,
  }
}

function buildUsageSeriesFromTimeline(items: UsageData['items'], windowStart: number) {
  const buckets = new Map<number, Map<string, number>>()
  const windowEnd = windowStart + USAGE_TREND_WINDOW_MS
  const firstBucket = Math.floor(windowStart / USAGE_TREND_BUCKET_MS) * USAGE_TREND_BUCKET_MS
  const labels: number[] = []
  for (let label = firstBucket; label <= windowEnd; label += USAGE_TREND_BUCKET_MS) {
    labels.push(label)
    buckets.set(label, new Map())
  }

  for (const item of items) {
    const timestamp = resolveUsageTimestamp(item)
    if (!timestamp || timestamp < windowStart || timestamp > windowEnd) {
      continue
    }
    const bucketKey = timestamp
      ? Math.floor(timestamp / USAGE_TREND_BUCKET_MS) * USAGE_TREND_BUCKET_MS
      : firstBucket
    const model = item.model_name || item.token_name || '未标注模型'
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, new Map())
    }
    const current = buckets.get(bucketKey)!
    current.set(model, (current.get(model) || 0) + Number(item.quota || 0))
  }

  const models = Array.from(new Set(items.map((item) => item.model_name || item.token_name || '未标注模型')))

  return {
    labels,
    models,
    buckets,
    formatLabel: (value: number) =>
      value
        ? dayjs(value).format('HH:mm')
        : '未知时间',
  }
}

function UsageTrendChart(props: {
  items: UsageData['items']
}) {
  const { items } = props
  const bounds = useMemo(() => resolveUsageTimelineBounds(items), [items])
  const [viewStart, setViewStart] = useState(bounds.latestWindowStart)
  const dragStateRef = useRef<{ x: number; start: number } | null>(null)
  useEffect(() => {
    setViewStart(bounds.latestWindowStart)
  }, [bounds.latestWindowStart])
  const effectiveViewStart = clampValue(viewStart, bounds.earliestWindowStart, bounds.latestWindowStart)
  const chart = useMemo(() => buildUsageSeriesFromTimeline(items, effectiveViewStart), [items, effectiveViewStart])
  const [hoveredPoint, setHoveredPoint] = useState<{
    model: string
    label: string
    value: number
    color: string
    x: number
    y: number
  } | null>(null)

  if (!chart.labels.length || !chart.models.length) {
    return <EmptyState title='暂无模型分析数据' description='开始使用模型后，这里会自动生成时间趋势。' />
  }

  const width = 760
  const height = 280
  const left = 36
  const right = 24
  const top = 18
  const bottom = 52
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const chartBottom = top + chartHeight
  const maxValue = Math.max(
    1,
    ...chart.labels.flatMap((label) => chart.models.map((model) => chart.buckets.get(label)?.get(model) || 0))
  )
  const gridRows = 4
  const tickStep = Math.max(1, Math.ceil(chart.labels.length / 6))
  const canPan = bounds.latestWindowStart > bounds.earliestWindowStart

  return (
    <div className={`usage-trend-card ${canPan ? 'pannable' : ''}`.trim()}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className='usage-trend-svg'
        role='img'
        aria-label='模型调用分析趋势图'
        onMouseLeave={() => setHoveredPoint(null)}
        onPointerDown={(event) => {
          if (!canPan || event.button !== 0) {
            return
          }
          dragStateRef.current = { x: event.clientX, start: effectiveViewStart }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!dragStateRef.current) {
            return
          }
          const deltaX = event.clientX - dragStateRef.current.x
          const deltaMs = -(deltaX / chartWidth) * USAGE_TREND_WINDOW_MS
          setViewStart(clampValue(dragStateRef.current.start + deltaMs, bounds.earliestWindowStart, bounds.latestWindowStart))
        }}
        onPointerUp={(event) => {
          dragStateRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          dragStateRef.current = null
        }}
      >
        <defs>
          <clipPath id='usage-trend-chart-clip'>
            <rect x={left} y={top} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>
        {Array.from({ length: gridRows + 1 }).map((_, index) => {
          const y = top + (chartHeight / gridRows) * index
          return (
            <line
              key={`grid-${index}`}
              x1={left}
              y1={y}
              x2={width - right}
              y2={y}
              className='usage-trend-grid'
            />
          )
        })}

        <g clipPath='url(#usage-trend-chart-clip)'>
          {chart.models.map((model, modelIndex) => {
            const values = chart.labels.map((label) => chart.buckets.get(label)?.get(model) || 0)
            const points = values.map((value, index) => {
              const x = left + (chartWidth * index) / Math.max(chart.labels.length - 1, 1)
              const y = clampChartCoordinate(top + chartHeight - (value / maxValue) * chartHeight, top, chartBottom)
              return { x, y }
            })
            const color = USAGE_CHART_COLORS[modelIndex % USAGE_CHART_COLORS.length]

            return (
              <g key={model}>
                <path d={buildSmoothLinePath(points, top, chartBottom)} fill='none' stroke={color} strokeWidth='2.5' strokeLinecap='round' />
                {points.map((point, index) => (
                  <circle
                    key={`${model}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r='4'
                    fill={color}
                    onMouseEnter={() =>
                      setHoveredPoint({
                        model,
                        label: chart.formatLabel(chart.labels[index]),
                        value: values[index],
                        color,
                        x: point.x,
                        y: point.y,
                      })
                    }
                    onMouseLeave={() => {
                      setHoveredPoint((current) =>
                        current?.model === model && current?.label === chart.formatLabel(chart.labels[index])
                          ? null
                          : current
                      )
                    }}
                  />
                ))}
              </g>
            )
          })}
        </g>

        {chart.labels.map((label, index) => {
          if (index % tickStep !== 0 && index !== chart.labels.length - 1) {
            return null
          }
          const x = left + (chartWidth * index) / Math.max(chart.labels.length - 1, 1)
          return (
            <text key={label} x={x} y={height - 14} textAnchor='middle' className='usage-trend-axis'>
              {chart.formatLabel(label)}
            </text>
          )
        })}
      </svg>
      {hoveredPoint ? (
        <div
          className='usage-trend-tooltip'
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`,
          }}
        >
          <span className='usage-trend-tooltip-model'>
            <span className='usage-trend-swatch' style={{ backgroundColor: hoveredPoint.color }} />
            <strong>{hoveredPoint.model}</strong>
          </span>
          <span>{hoveredPoint.label}</span>
          <strong>{formatQuota(hoveredPoint.value)}</strong>
        </div>
      ) : null}

      <div className='usage-trend-legend'>
        {chart.models.map((model, index) => (
          <div key={model} className='usage-trend-legend-item'>
            <span className='usage-trend-swatch' style={{ backgroundColor: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length] }} />
            <strong>{model}</strong>
            <span>{formatQuota(chart.labels.reduce((sum, label) => sum + (chart.buckets.get(label)?.get(model) || 0), 0))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}


export function SubscriptionsWorkspace(props: {
  toast: (message: string) => void
  user: UserProfile | null
  onRequestLogin: () => void
}) {
  const { toast, user, onRequestLogin } = props
  const initialPublicPlanCache = useMemo(() => readPublicSubscriptionPlansCache(), [])
  const [plans, setPlans] = useState<PlanRecord[]>(
    initialPublicPlanCache.length ? initialPublicPlanCache : PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS
  )
  const [subscriptionSelf, setSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<SubscriptionPaymentInfo | null>(null)
  const [quotaPerUnit, setQuotaPerUnit] = useState(500_000)
  const [buyingPlanId, setBuyingPlanId] = useState(0)
  const activeSubscriptions = (subscriptionSelf?.subscriptions || []).filter(
    (item) => !isSubscriptionExhausted(item.subscription) && !isSubscriptionExpired(item.subscription)
  )
  const allSubscriptions = subscriptionSelf?.all_subscriptions || []
  const visibleSubscriptionRecords = useMemo(
    () => allSubscriptions.filter((item) => !isSubscriptionExpired(item.subscription)),
    [allSubscriptions]
  )
  const recommendedPlanId = useMemo(() => resolveRecommendedSubscriptionPlanId(plans), [plans])
  const planById = useMemo(
    () => new Map(plans.map((item) => [item.plan.id, item.plan])),
    [plans]
  )
  const planTitleMap = useMemo(
    () => new Map(plans.map((item) => [item.plan.id, item.plan.title])),
    [plans]
  )
  const visiblePlans = useMemo(
    () =>
      plans.filter((item) => {
        if (user && isSubscriptionPlanPurchaseLimitReached(item.plan, allSubscriptions)) {
          return false
        }
        return true
      }),
    [allSubscriptions, plans, user]
  )
  const paymentOptions = useMemo(() => {
    const next: Array<{ key: string; label: string; variant: 'primary' | 'secondary' }> = []
    if (paymentInfo?.enable_wallet_payment) {
      next.push({ key: 'wallet', label: '钱包购买', variant: 'primary' })
    }
    return next
  }, [paymentInfo])
  const paymentStatusLabel = paymentOptions.length > 0 ? '可购买' : '待配置'

  function resolveSubscriptionUsagePrefix(planId: number) {
    const resetPeriod = planById.get(planId)?.quota_reset_period
    switch (resetPeriod) {
      case 'daily':
        return '当日已用'
      case 'weekly':
        return '当周已用'
      case 'monthly':
        return '当月已用'
      case 'custom':
        return '本周期已用'
      default:
        return '已用'
    }
  }

  const applyPlans = useCallback((nextPlans: PlanRecord[]) => {
    const enabledPlans = nextPlans.filter((item) => item.plan.enabled)
    if (!enabledPlans.length) {
      setPlans((current) => (current.length ? current : PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS))
      return
    }
    setPlans(enabledPlans)
    writePublicSubscriptionPlansCache(enabledPlans)
  }, [])

  const loadPublicPlansForSubscriptionWorkspace = useCallback(async () => {
    try {
      return await getPublicPlans()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!user || isAuthRequiredErrorMessage(message)) {
        return initialPublicPlanCache.length ? initialPublicPlanCache : PUBLIC_SUBSCRIPTION_PLAN_FALLBACKS
      }
      throw error
    }
  }, [initialPublicPlanCache, user])

  const refreshSubscriptions = useCallback(async () => {
    const nextPlans = await loadPublicPlansForSubscriptionWorkspace()
    const [nextSelf, nextPaymentInfo, nextStatus] = await Promise.all([
      user ? getSelfSubscriptions().catch(() => null) : Promise.resolve(null),
      user ? getSubscriptionPaymentInfo().catch(() => null) : Promise.resolve(null),
      unwrapEnvelope(getAuthStatus()).catch(() => null),
    ])
    applyPlans(nextPlans)
    setSubscriptionSelf(nextSelf ?? null)
    setPaymentInfo(nextPaymentInfo ?? null)
    const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
    if (resolvedQuotaPerUnit > 0) {
      setQuotaPerUnit(resolvedQuotaPerUnit)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const nextPlans = await loadPublicPlansForSubscriptionWorkspace()
        const [nextSelf, nextPaymentInfo, nextStatus] = await Promise.all([
          user ? getSelfSubscriptions().catch(() => null) : Promise.resolve(null),
          user ? getSubscriptionPaymentInfo().catch(() => null) : Promise.resolve(null),
          unwrapEnvelope(getAuthStatus()).catch(() => null),
        ])

        if (disposed) {
          return
        }

        applyPlans(nextPlans)
        setSubscriptionSelf(nextSelf ?? null)
        setPaymentInfo(nextPaymentInfo ?? null)
        const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
        if (resolvedQuotaPerUnit > 0) {
          setQuotaPerUnit(resolvedQuotaPerUnit)
        }
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : '加载订阅信息失败'
          if (!isAuthRequiredErrorMessage(message)) {
            toast(message)
          }
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [applyPlans, loadPublicPlansForSubscriptionWorkspace, toast, user])

  async function handleBuyPlan(planId: number, paymentMethod: string) {
    if (!user) {
      onRequestLogin()
      toast('请先登录 OneAPI 后购买套餐。')
      return
    }
    setBuyingPlanId(planId)
    try {
      const result = await paySubscription(planId, paymentMethod)
      const externalUrl = result?.checkout_url || result?.pay_link
      if (externalUrl) {
        await getDesktopBridge()?.openExternal(externalUrl)
      }
      toast(result?.notice || '订阅请求已发起。')
      await refreshSubscriptions()
    } catch (error) {
      toast(error instanceof Error ? error.message : '购买套餐失败')
    } finally {
      setBuyingPlanId(0)
    }
  }

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>套餐订阅</h2>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='stats-inline page-stats-grid'>
            <div className='mini-stat'>
              <strong>{plans.length}</strong>
              <span>可选套餐</span>
            </div>
            <div className='mini-stat'>
              <strong>{activeSubscriptions.length}</strong>
              <span>当前生效订阅</span>
            </div>
            <div className='mini-stat'>
              <strong>{allSubscriptions.length}</strong>
              <span>全部订阅记录</span>
            </div>
            <div className='mini-stat'>
              <strong>{paymentStatusLabel}</strong>
              <span>支付状态</span>
            </div>
          </div>

          <div className='content-grid subscription-layout'>
            <div className='subscription-grid wide-grid'>
              {visiblePlans.length === 0 ? (
                <EmptyState title='当前没有可购买套餐' description='请稍后刷新或检查服务端套餐配置。' />
              ) : (
                visiblePlans.map((item) => {
                  const purchaseLimit = Number(item.plan.max_purchase_per_user || 0)
                  const purchaseCount = countPlanPurchases(allSubscriptions, item.plan.id)
                  const limitReached = purchaseLimit > 0 && purchaseCount >= purchaseLimit
                  const buying = buyingPlanId === item.plan.id
                  const isTrialPlan = isTrialSubscriptionPlan(item.plan)
                  const isRecommended = item.plan.id === recommendedPlanId || isTrialPlan
                  const quotaUsd = Number(item.plan.total_amount || 0) > 0 ? formatQuotaAsUsd(item.plan.total_amount, quotaPerUnit) : '不限额度'
                  const quotaMillion = Number(item.plan.total_amount || 0) > 0 ? formatQuotaAsMillions(item.plan.total_amount) : 'unlimited'
                  const resetRule = formatSubscriptionResetPeriod(item.plan)
                  const validity = formatSubscriptionDuration(item.plan)
                  const planBadge = resolveSubscriptionPlanBadge(item.plan)

                  return (
                    <article
                      key={item.plan.id}
                      className={`pricing-card subscription-plan-card ${isRecommended ? 'recommended' : ''} ${limitReached ? 'limit-reached' : ''}`}
                    >
                      <div className='subscription-plan-badge-row'>
                        <div className='subscription-plan-badge-group'>
                          <span className={`subscription-plan-badge ${planBadge.tone === 'annual' ? 'annual' : 'subtle'}`}>
                            {planBadge.label}
                          </span>
                          {isRecommended ? (
                            <span className='subscription-plan-badge recommended'>
                              <Sparkles size={14} />
                              <span>推荐</span>
                            </span>
                          ) : null}
                        </div>
                        {purchaseLimit > 0 ? (
                          <span className={`subscription-plan-badge ${limitReached ? 'muted' : 'subtle'}`}>
                            限购 {purchaseCount}/{purchaseLimit}
                          </span>
                        ) : null}
                      </div>

                      <div className='subscription-plan-head'>
                        <strong>{item.plan.title}</strong>
                        <span className='subscription-plan-subtitle'>
                          {item.plan.subtitle || '适合稳定桌面端高频使用。'}
                        </span>
                      </div>

                      <div className='subscription-plan-price-group'>
                        <div className='subscription-plan-price-row'>
                          <b>{formatPlainPrice(item.plan.price_amount)}</b>
                          <span className='subscription-plan-price-unit'>人民币</span>
                        </div>
                      </div>

                      <div className='subscription-plan-quota'>
                        <span className='subscription-plan-quota-label'>总额度</span>
                        <div className='subscription-plan-quota-values'>
                          <strong>{quotaUsd}</strong>
                          <strong className='subscription-plan-quota-divider'>|</strong>
                          <strong className='subscription-plan-token-value'>{`${quotaMillion} Token`}</strong>
                        </div>
                      </div>

                      <div className='subscription-plan-meta'>
                        <span>{`有效期 ${validity}`}</span>
                        <span>{`重置规则 ${resetRule}`}</span>
                      </div>

                      <div className='pricing-actions subscription-plan-actions'>
                        {!user ? (
                          <button
                            className='primary-button tiny'
                            type='button'
                            onClick={() => {
                              onRequestLogin()
                              toast('请先登录 OneAPI 后购买套餐。')
                            }}
                          >
                            登录购买
                          </button>
                        ) : paymentOptions.length > 0 ? (
                          paymentOptions.map((option) => (
                            <button
                              key={`${item.plan.id}-${option.key}`}
                              className={`${option.variant === 'primary' ? 'primary-button' : 'secondary-button'} tiny`}
                              type='button'
                              disabled={buying || limitReached}
                              onClick={() => void handleBuyPlan(item.plan.id, option.key)}
                            >
                              {limitReached ? '已达上限' : option.label}
                            </button>
                          ))
                        ) : (
                          <button className='ghost-button tiny' type='button' disabled>
                            暂无可用支付方式
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>

            <div className='subscription-side-column'>
              <div className='panel-block'>
                <div className='list-block-header'>
                  <strong>已有订阅</strong>
                  <span>查看当前订阅状态与额度使用情况</span>
                </div>
                <div className='subrecords'>
                  {visibleSubscriptionRecords.length === 0 ? (
                    <EmptyState title='还没有订阅记录' description='购买套餐后会在这里看到订阅状态和用量。' />
                  ) : (
                    visibleSubscriptionRecords.map((item) => {
                      const exhausted = isSubscriptionExhausted(item.subscription)
                      return (
                        <div key={item.subscription.id} className={`record-row subscription-record-row ${exhausted ? 'exhausted' : ''}`}>
                          <div className='subscription-record-main'>
                            <strong>{planTitleMap.get(item.subscription.plan_id) || `订阅 #${item.subscription.id}`}</strong>
                            <span>
                              {resolveSubscriptionUsagePrefix(item.subscription.plan_id)} {formatQuotaAsUsd(item.subscription.amount_used, quotaPerUnit)} /{' '}
                              {Number(item.subscription.amount_total || 0) > 0
                                ? formatQuotaAsUsd(item.subscription.amount_total, quotaPerUnit)
                                : '不限额度'}
                            </span>
                            <small>
                              有效至 {formatDateTime(item.subscription.end_time)}
                              {item.subscription.next_reset_time ? ` · 下次重置 ${formatDateTime(item.subscription.next_reset_time)}` : ''}
                            </small>
                          </div>
                          <div className='subscription-record-side'>
                            <div className={`subscription-progress-inline ${exhausted ? 'exhausted' : ''}`}>
                              <div className='usage-bar-track'>
                                <div
                                  className='usage-bar-fill'
                                  style={{ width: `${percentageOf(item.subscription.amount_used, item.subscription.amount_total)}%` }}
                                />
                              </div>
                            </div>
                            <small className='subscription-record-status'>{resolveSubscriptionStatusLabel(item.subscription)}</small>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

export function WalletWorkspace(props: {
  user: UserProfile
  toast: (message: string) => void
  onUserRefresh?: (user: UserProfile) => void
}) {
  const { user, toast, onUserRefresh } = props
  const [quotaPerUnit, setQuotaPerUnit] = useState(500_000)
  const [billing, setBilling] = useState<BillingHistoryData | null>(null)
  const [walletPlans, setWalletPlans] = useState<PlanRecord[]>([])
  const [walletSubscriptionSelf, setWalletSubscriptionSelf] = useState<SubscriptionSelfData | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null)
  const [topupAmount, setTopupAmount] = useState('')
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('')
  const [payingTopup, setPayingTopup] = useState(false)
  const [alipayPayment, setAlipayPayment] = useState<{
    tradeNo: string
    payUrl?: string
    checkoutUrl?: string
    payForm?: string
    amount: string
    expiresIn: number
  } | null>(null)
  const [checkingAlipay, setCheckingAlipay] = useState(false)
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [perfMetrics, setPerfMetrics] = useState<{ requestCount24h: number; avgLatencyMs: number } | null>(null)
  const [usageDistributionPage, setUsageDistributionPage] = useState(0)

  const recentBills = useMemo(
    () =>
      [...(billing?.items || [])]
        .sort((left, right) => Number(right.create_time || 0) - Number(left.create_time || 0))
        .slice(0, 3),
    [billing?.items]
  )
  const completedBillCount = recentBills.filter((item) => item.status === 'success').length
  const walletBalance = Number(user.quota || 0)
  const tokenBalance = Number(user.quota || 0)
  const tokenExpense = Number(user.used_quota || 0)
  const requestCount24h = perfMetrics?.requestCount24h ?? 0
  const modelSummary = useMemo(
    () => usageModelSummary(usageData?.items || []),
    [usageData?.items]
  )
  const totalQuota = modelSummary.reduce((sum, item) => sum + item.quota, 0)
  const usageDistributionPageSize = 5
  const usageDistributionPageCount = Math.max(1, Math.ceil(modelSummary.length / usageDistributionPageSize))
  const visibleUsageModels = modelSummary.slice(
    usageDistributionPage * usageDistributionPageSize,
    usageDistributionPage * usageDistributionPageSize + usageDistributionPageSize
  )
  const avgTpm = useMemo(() => {
    const logs = usageData?.items || []
    const timestamps = logs
      .map((item) => Number(item.created_at || item.created_time || 0))
      .filter((value) => value > 0)
      .sort((left, right) => left - right)
    if (timestamps.length < 2) {
      return 0
    }
    const timeDiff = (timestamps.at(-1)! - timestamps[0]) / 60000
    return timeDiff > 0 ? totalQuota / timeDiff : 0
  }, [totalQuota, usageData?.items])
  const avgLatency = perfMetrics?.avgLatencyMs ?? 0
  const alipayPollingRef = useRef<number | null>(null)
  const enabledPaymentMethods = useMemo(() => getAlipayTopupMethods(topupInfo), [topupInfo])
  const minTopupAmount = useMemo(() => {
    const methodMin = enabledPaymentMethods
      .filter((item) => !selectedPaymentMethod || item.type === selectedPaymentMethod)
      .map((item) => Number(item.min_topup || 0))
      .find((value) => value > 0)
    return methodMin || Number(topupInfo?.min_topup || 0) || 1
  }, [enabledPaymentMethods, selectedPaymentMethod, topupInfo?.min_topup])
  const amountOptions = useMemo(() => {
    const options = (topupInfo?.amount_options || [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
    const next = options.length ? options : [minTopupAmount, 50, 100]
    return [...new Set(next.filter((item) => item >= minTopupAmount && item !== 50))]
  }, [minTopupAmount, topupInfo?.amount_options])
  const subscriptionUsageByTitle = useMemo(() => {
    const planTitleMap = new Map(walletPlans.map((item) => [item.plan.id, item.plan.title]))
    const records = walletSubscriptionSelf?.all_subscriptions || []
    const next = new Map<
      string,
      {
        updatedAt: number
        percentage: number
      }
    >()

    for (const item of records) {
      const title = planTitleMap.get(item.subscription.plan_id)?.trim()
      if (!title) {
        continue
      }

      const updatedAt = Number(item.subscription.end_time || item.subscription.start_time || item.subscription.id || 0)
      const current = next.get(title)
      if (current && current.updatedAt > updatedAt) {
        continue
      }

      next.set(title, {
        updatedAt,
        percentage: percentageOf(item.subscription.amount_used, item.subscription.amount_total),
      })
    }

    return next
  }, [walletPlans, walletSubscriptionSelf])

  function formatBillingLabel(item: BillingHistoryData['items'][number]) {
    if (item.plan_title?.trim()) {
      return item.plan_title.trim()
    }
    const trade = String(item.trade_no || '').replace(/SUBWALLETUSR1NO[a-zA-Z0-9_-]*/g, '').trim()
    const payment = String(item.payment_method || '').replace(/^wallet$/i, '').trim()
    return trade || payment || '购买记录'
  }

  function resolveBillingUsagePercentage(item: BillingHistoryData['items'][number]) {
    const title = item.plan_title?.trim()
    if (!title) {
      return 0
    }
    return subscriptionUsageByTitle.get(title)?.percentage || 0
  }

  function formatBillingAmount(item: BillingHistoryData['items'][number]) {
    const method = String(item.payment_method || '').trim().toLowerCase()
    const amount = method === 'alipay'
      ? Number(item.amount || item.money || 0)
      : Number(item.money || item.amount || 0)
    return formatPrice(amount, 'CNY')
  }

  const refreshWallet = useCallback(async () => {
    const [nextBilling, nextTopupInfo, nextPlans, nextSelf, nextStatus] = await Promise.all([
      getBillingHistory(1, 3),
      getTopupInfo().catch(() => null),
      getPublicPlans().catch(() => []),
      getSelfSubscriptions().catch(() => null),
      unwrapEnvelope(getAuthStatus()).catch(() => null),
    ])
    setBilling(nextBilling ?? null)
    if (nextTopupInfo) {
      setTopupInfo(nextTopupInfo)
    }
    setWalletPlans((nextPlans || []).filter((item) => item.plan.enabled))
    setWalletSubscriptionSelf(nextSelf)
    const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
    if (resolvedQuotaPerUnit > 0) {
      setQuotaPerUnit(resolvedQuotaPerUnit)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    if (!onUserRefresh) {
      return
    }
    const profile = await unwrapEnvelope(getSelfProfile())
    if (profile) {
      onUserRefresh(profile as UserProfile)
    }
  }, [onUserRefresh])

  const stopAlipayPolling = useCallback(() => {
    if (!alipayPollingRef.current) {
      return
    }
    window.clearInterval(alipayPollingRef.current)
    alipayPollingRef.current = null
  }, [])

  const closeAlipayPayment = useCallback(() => {
    stopAlipayPolling()
    setAlipayPayment(null)
  }, [stopAlipayPolling])

  const completeAlipayPayment = useCallback(async () => {
    stopAlipayPolling()
    setAlipayPayment(null)
    toast('支付成功，余额已刷新。')
    await refreshWallet()
    await refreshUser()
  }, [refreshUser, refreshWallet, stopAlipayPolling, toast])

  const checkAlipayPaymentStatus = useCallback(async (tradeNo: string, manual = false) => {
    if (!tradeNo) {
      return
    }
    if (manual) {
      setCheckingAlipay(true)
    }
    try {
      const result = await queryAlipayTopupOrder(tradeNo)
      if (result?.status === 'success') {
        await completeAlipayPayment()
        return
      }
      if (manual) {
        toast('暂未确认支付，请稍后刷新。')
      }
    } catch (error) {
      if (manual) {
        toast(error instanceof Error ? error.message : '暂未确认支付，请稍后刷新。')
      }
    } finally {
      if (manual) {
        setCheckingAlipay(false)
      }
    }
  }, [completeAlipayPayment, toast])

  const openAlipayCashier = useCallback(async (payment: { payForm?: string; checkoutUrl?: string; payUrl?: string }) => {
    const payForm = String(payment.payForm || '').trim()
    const checkoutUrl = String(payment.checkoutUrl || payment.payUrl || '').trim()
    if (!payForm && !checkoutUrl) {
      toast('服务端未返回支付宝收银台地址。')
      return
    }
    try {
      if (payForm) {
        await getDesktopBridge()?.openHtml({
          html: payForm,
          suggestedName: 'alipay-checkout',
        })
        return
      }
      await getDesktopBridge()?.openExternal(checkoutUrl)
    } catch {
      if (payForm && checkoutUrl) {
        try {
          await getDesktopBridge()?.openExternal(checkoutUrl)
          return
        } catch {
          /* fallback failed, surface the generic error below */
        }
      }
      toast('打开支付宝收银台失败，请稍后重试。')
    }
  }, [toast])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const [nextBilling, nextTopupInfo, nextUsageData, nextPerfMetrics, nextPlans, nextSelf, nextStatus] = await Promise.all([
          getBillingHistory(1, 3),
          getTopupInfo().catch(() => null),
          getUserUsageLogs(1, 200),
          getPerfMetricsSummary(24).catch(() => null),
          getPublicPlans().catch(() => []),
          getSelfSubscriptions().catch(() => null),
          unwrapEnvelope(getAuthStatus()).catch(() => null),
        ])

        if (disposed) {
          return
        }

        setBilling(nextBilling ?? null)
        if (nextTopupInfo) {
          setTopupInfo(nextTopupInfo)
          const defaultMethod = nextTopupInfo.pay_methods?.find((item) => item.type?.trim())?.type?.trim() || ''
          const defaultAlipayMethod = getAlipayTopupMethods(nextTopupInfo)[0]?.type || defaultMethod
          if (defaultAlipayMethod) {
            setSelectedPaymentMethod((current) => current || defaultAlipayMethod)
          }
          const defaultAmount = Number(nextTopupInfo.amount_options?.find((item) => Number(item) > 0 && Number(item) !== 50) || nextTopupInfo.min_topup || 0)
          if (defaultAmount > 0) {
            setTopupAmount((current) => current || String(defaultAmount))
          }
        }
        setUsageData(nextUsageData ?? null)
        setWalletPlans((nextPlans || []).filter((item) => item.plan.enabled))
        setWalletSubscriptionSelf(nextSelf)
        const resolvedQuotaPerUnit = Number(nextStatus?.quota_per_unit || 0)
        if (resolvedQuotaPerUnit > 0) {
          setQuotaPerUnit(resolvedQuotaPerUnit)
        }
        if (nextPerfMetrics?.models?.length) {
          const requestCount = nextPerfMetrics.models.reduce((sum, item) => sum + Number(item.request_count || 0), 0)
          const latencyTotal = nextPerfMetrics.models.reduce((sum, item) => {
            const requestCount = Number(item.request_count || 0)
            const latency = Number(item.avg_latency_ms || 0)
            return sum + latency * requestCount
          }, 0)
          setPerfMetrics({
            requestCount24h: requestCount,
            avgLatencyMs: requestCount > 0 ? Math.round(latencyTotal / requestCount) : 0,
          })
        }
      } catch (error) {
        if (!disposed) {
          toast(error instanceof Error ? error.message : '加载钱包信息失败')
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [toast])

  useEffect(() => {
    setUsageDistributionPage((current) => Math.min(current, usageDistributionPageCount - 1))
  }, [usageDistributionPageCount])

  useEffect(() => {
    if (!amountOptions.length) {
      return
    }
    const currentAmount = Number(topupAmount)
    if (!amountOptions.includes(currentAmount)) {
      setTopupAmount(String(amountOptions[0]))
    }
  }, [amountOptions, topupAmount])

  useEffect(() => {
    stopAlipayPolling()
    const tradeNo = alipayPayment?.tradeNo
    if (!tradeNo) {
      return undefined
    }

    alipayPollingRef.current = window.setInterval(() => {
      void checkAlipayPaymentStatus(tradeNo)
    }, 3000)

    return () => {
      stopAlipayPolling()
    }
  }, [alipayPayment?.tradeNo, checkAlipayPaymentStatus, stopAlipayPolling])

  async function handleRedeem() {
    if (!redeemCode.trim()) {
      toast('请输入兑换码。')
      return
    }
    try {
      await redeemTopupCode(redeemCode.trim())
      setRedeemCode('')
      toast('兑换成功，钱包余额已刷新。')
      await refreshWallet()
    } catch (error) {
      toast(error instanceof Error ? error.message : '兑换失败')
    }
  }

  async function handleOpenRedeemCodePurchase() {
    await getDesktopBridge()?.openExternal(REDEEM_CODE_PURCHASE_URL)
  }

  async function handleWalletPayment() {
    const resolvedAmount = Number(topupAmount)
    if (!Number.isFinite(resolvedAmount) || resolvedAmount < minTopupAmount) {
      toast(`充值金额不能低于 ¥${formatPlainPrice(minTopupAmount)}。`)
      return
    }
    if (!selectedPaymentMethod) {
      toast('请选择支付方式。')
      return
    }
    if (selectedPaymentMethod !== 'alipay') {
      toast('当前仅支持支付宝收银台充值。')
      return
    }
    setPayingTopup(true)
    try {
      const result = await createAlipayTopupOrder(Math.trunc(resolvedAmount))
      const payUrl = String(result.pay_url || '').trim()
      const checkoutUrl = String(result.checkout_url || '').trim()
      const payForm = String(result.pay_form || '').trim()
      setAlipayPayment({
        tradeNo: result.trade_no,
        payUrl,
        checkoutUrl,
        payForm,
        amount: String(Math.trunc(resolvedAmount)),
        expiresIn: Number(result.expires_in || 0),
      })
      await openAlipayCashier({ payForm, checkoutUrl, payUrl })
    } catch (error) {
      toast(error instanceof Error ? error.message : '创建支付宝订单失败')
    } finally {
      setPayingTopup(false)
    }
  }

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>用量账单</h2>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='panel-block hero-panel-block wallet-overview-card wallet-overview-top'>
            <div className='wallet-overview-head'>
              <div>
                <span className='eyebrow dark'>账户统计</span>
                <h3>钱包总览</h3>
              </div>
              <span className='metric-pill success'>已完成账单 {completedBillCount}</span>
            </div>
            <div className='wallet-overview-grid'>
              <div className='wallet-overview-metric'>
                <strong>{formatQuotaAsUsd(walletBalance, quotaPerUnit)}</strong>
                <span>当前余额</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(tokenBalance)}</strong>
                <span>Token 余额</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(tokenExpense)}</strong>
                <span>Token 消耗</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(requestCount24h)}</strong>
                <span>请求数（24 小时）</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(avgTpm)}</strong>
                <span>平均 TPM</span>
              </div>
              <div className='wallet-overview-metric'>
                <strong>{formatQuota(avgLatency)}</strong>
                <span>平均延迟</span>
              </div>
            </div>
          </div>

          <div className='content-grid wallet-grid'>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>充值与兑换</strong>
                <span>兑换码购买与服务端支付订单入口</span>
              </div>
              <div className='wallet-topup-split'>
                <div className='wallet-topup-pane'>
                  <div className='wallet-topup-pane-head'>
                    <strong>兑换码</strong>
                    <span>已有兑换码可直接入账</span>
                  </div>
                  <div className='subform compact'>
                    <input
                      value={redeemCode}
                      onChange={(event) => setRedeemCode(event.target.value)}
                      placeholder='输入兑换码'
                    />
                    <button className='secondary-button full' type='button' onClick={() => void handleRedeem()}>
                      兑换充值码
                    </button>
                  </div>
                  <button className='ghost-button full' type='button' onClick={() => void handleOpenRedeemCodePurchase()}>
                    购买兑换码
                  </button>
                </div>

                <div className='wallet-topup-pane'>
                  <div className='wallet-topup-pane-head'>
                    <strong>在线充值</strong>
                    <span>服务端创建支付订单并关联当前账号</span>
                  </div>
                  <div className='wallet-amount-options'>
                    {amountOptions.map((amount) => (
                      <button
                        key={amount}
                        className={`ghost-button tiny ${Number(topupAmount) === amount ? 'active' : ''}`.trim()}
                        type='button'
                        onClick={() => setTopupAmount(String(amount))}
                      >
                        ¥{formatPlainPrice(amount)}
                      </button>
                    ))}
                  </div>
                  <div className='wallet-payment-row'>
                    <select
                      value={selectedPaymentMethod}
                      onChange={(event) => setSelectedPaymentMethod(event.target.value)}
                      disabled={!enabledPaymentMethods.length}
                    >
                      {enabledPaymentMethods.length ? enabledPaymentMethods.map((method) => (
                        <option key={method.type} value={method.type}>
                          {method.name || method.type}
                        </option>
                      )) : (
                        <option value=''>未启用支付方式</option>
                      )}
                    </select>
                    <button
                      className='secondary-button'
                      type='button'
                      disabled={payingTopup || !enabledPaymentMethods.length || !topupAmount}
                      onClick={() => void handleWalletPayment()}
                    >
                      {payingTopup ? '创建中...' : '支付宝收银台支付'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>最近账单</strong>
                <span>最近的充值、兑换与支付记录</span>
              </div>
              <div className='subrecords'>
                {(billing?.items || []).length === 0 ? (
                  <EmptyState title='当前没有账单记录' description='充值、兑换或订阅支付后会显示在这里。' />
                ) : (
                  <div className='billing-grid'>
                    {recentBills.map((item, index) => {
                      const usagePercentage = resolveBillingUsagePercentage(item)
                      const exhausted = usagePercentage >= 100
                      return (
                        <div key={String(item.trade_no || index)} className={`billing-card ${exhausted ? 'exhausted' : ''}`}>
                          <div
                            className='billing-card-fill'
                            style={{
                              width: `${usagePercentage}%`,
                            }}
                          />
                          <div className='billing-card-inner'>
                            <strong>{formatBillingLabel(item)}</strong>
                            <span>{formatBillingAmount(item)}</span>
                            <small>{item.status === 'success' ? '已完成' : item.status === 'pending' ? '处理中' : '已过期'}</small>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>消耗分布</strong>
                <span>按模型统计当前账户的额度消耗</span>
              </div>
              {modelSummary.length === 0 ? (
                <EmptyState title='当前没有用量记录' description='模型调用后会在这里显示消耗分布。' />
              ) : (
                <>
                  <div className='usage-bars'>
                    {visibleUsageModels.map((item) => (
                      <div key={item.model} className='usage-bar-row'>
                        <div className='usage-bar-head'>
                          <strong>{item.model}</strong>
                          <span>
                            {formatQuota(item.quota)}
                            <b>|</b>
                            占比 {percentageOf(item.quota, totalQuota).toFixed(1)}%
                          </span>
                        </div>
                        <div className='usage-bar-track'>
                          <div className='usage-bar-fill' style={{ width: `${percentageOf(item.quota, totalQuota)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {usageDistributionPageCount > 1 ? (
                    <div className='usage-distribution-pager'>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        disabled={usageDistributionPage <= 0}
                        onClick={() => setUsageDistributionPage((current) => Math.max(0, current - 1))}
                      >
                        上一页
                      </button>
                      <span>{usageDistributionPage + 1} / {usageDistributionPageCount}</span>
                      <button
                        className='ghost-button tiny'
                        type='button'
                        disabled={usageDistributionPage >= usageDistributionPageCount - 1}
                        onClick={() => setUsageDistributionPage((current) => Math.min(usageDistributionPageCount - 1, current + 1))}
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className='panel-block'>
              <div className='list-block-header'>
                <strong>模型调用分析</strong>
                <span>按时间轴绘制各模型的额度消耗曲线</span>
              </div>
              <UsageTrendChart items={usageData?.items || []} />
            </div>
          </div>
        </div>
      </article>
      {alipayPayment ? createPortal(
        <div className='modal-mask alipay-pay-modal-mask' role='presentation'>
          <div className='modal-card alipay-pay-modal' role='dialog' aria-modal='true' aria-label='支付宝收银台支付'>
            <div className='panel-header compact'>
              <div>
                <h2>支付宝收银台支付</h2>
                <p>已打开支付宝收银台，支付完成后余额会自动到账。</p>
              </div>
              <button className='alipay-pay-close' type='button' onClick={closeAlipayPayment} aria-label='关闭'>
                <X size={18} />
              </button>
            </div>
            <div className='alipay-qr-body'>
              <div className='alipay-cashier-notice'>
                <strong>请在系统浏览器中完成支付</strong>
                <span>可在支付宝收银台扫码或登录支付宝支付；本窗口会继续查询支付状态。</span>
              </div>
              <div className='alipay-pay-details'>
                <div>
                  <span>支付金额</span>
                  <strong>¥{formatPlainPrice(Number(alipayPayment.amount))}</strong>
                </div>
                <div>
                  <span>订单号</span>
                  <strong>{alipayPayment.tradeNo}</strong>
                </div>
                <div>
                  <span>有效期</span>
                  <strong>{formatExpiresIn(alipayPayment.expiresIn)}</strong>
                </div>
              </div>
              <div className='alipay-pay-actions'>
                <button
                  className='ghost-button'
                  type='button'
                  onClick={() => void openAlipayCashier(alipayPayment)}
                >
                  重新打开
                </button>
                <button
                  className='secondary-button'
                  type='button'
                  disabled={checkingAlipay}
                  onClick={() => void checkAlipayPaymentStatus(alipayPayment.tradeNo, true)}
                >
                  {checkingAlipay ? '查询中...' : '我已支付'}
                </button>
                <button className='ghost-button' type='button' onClick={closeAlipayPayment}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </section>
  )
}

export function ServiceStatusWorkspace(props: {
  toast: (message: string) => void
}) {
  const { toast } = props
  const initialServiceStatusCache = useMemo(() => readServiceStatusCache(), [])
  const [serviceStatusItems, setServiceStatusItems] = useState<ServiceStatusItem[]>(initialServiceStatusCache.items)
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false)
  const [serviceStatusError, setServiceStatusError] = useState('')
  const [serviceStatusRefreshedAt, setServiceStatusRefreshedAt] = useState(initialServiceStatusCache.refreshedAt)
  const [serviceStatusTooltip, setServiceStatusTooltip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [, setServiceStatusMode] = useState<'status-page' | 'channel-test'>(initialServiceStatusCache.mode)
  const serviceStatusRequestedRef = useRef(false)
  const serviceStatusRefreshingRef = useRef(false)

  const resolveServiceStatusLabel = useCallback((item: ServiceStatusItem) => {
    switch (item.tone) {
      case 'up':
        return { text: '运行正常', className: 'success' }
      case 'down':
        return { text: '服务异常', className: 'danger' }
      case 'maintenance':
        return { text: '维护中', className: 'warn' }
      default:
        return { text: '状态未知', className: 'muted' }
    }
  }, [])

  const resolveServiceStatusHistoryTitle = useCallback(
    (item: ServiceStatusItem, checkedAt: number, index: number) => {
      const history = item.history || []
      const target = history[index]
      const statusText = target
        ? resolveServiceStatusLabel({ ...item, tone: target.tone }).text
        : resolveServiceStatusLabel(item).text
      const latencyText = target?.latencyMs ? ` · 延迟 ${target.latencyMs} ms` : ''
      const detailText = target?.detail?.trim() ? ` · ${target.detail.trim()}` : ''
      return `${formatDateTime(checkedAt)} · ${statusText}${latencyText}${detailText}`
    },
    [resolveServiceStatusLabel]
  )

  const refreshServiceStatus = useCallback(async () => {
    if (serviceStatusRefreshingRef.current) {
      return
    }
    serviceStatusRefreshingRef.current = true
    setServiceStatusLoading(true)
    setServiceStatusError('')
    try {
      const snapshot = await getServiceStatusSnapshot()
      const nextItems = snapshot.items.map((item) => ({
        ...item,
        history: item.history || [],
      }))
      const refreshedAt = Number(snapshot.refreshedAt || 0) > 0 ? Number(snapshot.refreshedAt) : Date.now()

      setServiceStatusItems(nextItems)
      setServiceStatusMode(snapshot.mode)
      setServiceStatusRefreshedAt(refreshedAt)
      writeServiceStatusCache({
        items: nextItems,
        refreshedAt,
        mode: snapshot.mode,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载服务状态失败'
      if (!isAuthRequiredErrorMessage(message)) {
        setServiceStatusError(message)
      }
      if (serviceStatusItems.length === 0 && !isAuthRequiredErrorMessage(message)) {
        toast(message)
      }
    } finally {
      serviceStatusRefreshingRef.current = false
      setServiceStatusLoading(false)
    }
  }, [serviceStatusItems.length, toast])

  useEffect(() => {
    if (!serviceStatusRequestedRef.current) {
      serviceStatusRequestedRef.current = true
      void refreshServiceStatus()
    }
    const intervalId = window.setInterval(() => {
      void refreshServiceStatus()
    }, SERVICE_STATUS_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [refreshServiceStatus])

  useEffect(() => {
    function handlePointerDown(event: globalThis.PointerEvent) {
      if (event.target instanceof Element && event.target.closest('.service-status-history-dot')) {
        return
      }
      setServiceStatusTooltip(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <section className='workspace-page full-bleed-page'>
      <article className='panel scroll-panel page-surface'>
        <div className='panel-header compact'>
          <div>
            <h2>服务状态</h2>
          </div>
          <div className='inline-actions'>
            <button
              className='ghost-button icon-only tiny'
              type='button'
              onClick={() => void refreshServiceStatus()}
              title='刷新服务状态'
              aria-label='刷新服务状态'
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className='panel-scroll'>
          <div className='panel-block'>
            <div className='list-block-header'>
              <strong>渠道运行状态</strong>
              <span>最近状态变化</span>
            </div>
            {serviceStatusRefreshedAt ? <small className='muted'>{`最后更新：${formatDateTime(serviceStatusRefreshedAt)}`}</small> : null}
            {serviceStatusLoading && serviceStatusItems.length === 0 ? (
              <EmptyState title='正在读取服务状态' description='正在同步服务器已配置渠道状态。' />
            ) : serviceStatusError && serviceStatusItems.length === 0 ? (
              <EmptyState title='服务状态读取失败' description={serviceStatusError} />
            ) : serviceStatusItems.length === 0 ? (
              <EmptyState title='当前没有可展示的服务状态' description='服务器尚未配置 Claude、Codex、Gemini、DeepSeek 或 XiaomiMIMO 渠道。' />
            ) : (
              <>
                {serviceStatusError ? <small className='muted'>{`刷新失败，当前展示缓存结果：${serviceStatusError}`}</small> : null}
                <div className='service-status-grid'>
                  {serviceStatusItems.map((item) => {
                    const statusMeta = resolveServiceStatusLabel(item)
                    return (
                      <div key={item.id} className='service-status-card'>
                        <div className='service-status-card-head'>
                          <div>
                            <strong>{item.title}</strong>
                            {item.subtitle ? <span>{item.subtitle}</span> : null}
                          </div>
                          <span className={`service-status-pill ${statusMeta.className}`}>{statusMeta.text}</span>
                        </div>
                        {item.history?.length ? (
                          <div className='service-status-history' aria-label={`${item.title} 最近状态历史`}>
                            {item.history.map((entry, index) => {
                              const historyMeta = resolveServiceStatusLabel({ ...item, tone: entry.tone })
                              return (
                                <span
                                  key={`${item.id}-history-${entry.checkedAt}-${index}`}
                                  className={`service-status-history-dot ${historyMeta.className}`}
                                  role='button'
                                  tabIndex={0}
                                  aria-label={resolveServiceStatusHistoryTitle(item, entry.checkedAt, index)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setServiceStatusTooltip({
                                      x: event.clientX,
                                      y: event.clientY,
                                      text: resolveServiceStatusHistoryTitle(item, entry.checkedAt, index),
                                    })
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                      return
                                    }
                                    event.preventDefault()
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    setServiceStatusTooltip({
                                      x: rect.left + rect.width / 2,
                                      y: rect.top + rect.height / 2,
                                      text: resolveServiceStatusHistoryTitle(item, entry.checkedAt, index),
                                    })
                                  }}
                                />
                              )
                            })}
                          </div>
                        ) : null}
                        <div className='service-status-card-meta'>
                          {item.latencyMs ? <small>{`延迟 ${item.latencyMs} ms`}</small> : null}
                          {item.checkedAt ? <small>{`检测时间 ${formatDateTime(item.checkedAt)}`}</small> : null}
                        </div>
                        {item.detail ? <p>{item.detail}</p> : null}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {serviceStatusTooltip ? createPortal(
              <div
                className='service-status-point-tooltip'
                style={{
                  left: serviceStatusTooltip.x,
                  top: serviceStatusTooltip.y,
                }}
              >
                {serviceStatusTooltip.text}
              </div>,
              document.body
            ) : null}
          </div>
        </div>
      </article>
    </section>
  )
}

