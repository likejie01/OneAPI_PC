import { desktopEnvelope } from '../lib/desktop-client'
import type {
  PlanRecord,
  SubscriptionSelfData,
  SubscriptionPaymentInfo,
} from '../shared/contracts'

export async function getPublicPlans() {
  const response = await desktopEnvelope<PlanRecord[]>({
    method: 'GET',
    path: '/api/subscription/plans',
  })
  return response.data ?? []
}

export async function getSelfSubscriptions() {
  const response = await desktopEnvelope<SubscriptionSelfData>({
    method: 'GET',
    path: '/api/subscription/self',
  })
  return (
    response.data ?? {
      billing_preference: '',
      subscriptions: [],
      all_subscriptions: [],
    }
  )
}

export async function getSubscriptionPaymentInfo() {
  const response = await desktopEnvelope<SubscriptionPaymentInfo>({
    method: 'GET',
    path: '/api/subscription/payment/info',
  })
  return response.data
}

export async function paySubscription(planId: number, paymentMethod: string) {
  const path =
    paymentMethod === 'wallet'
      ? '/api/subscription/wallet/pay'
      : paymentMethod === 'stripe'
        ? '/api/subscription/stripe/pay'
        : paymentMethod === 'creem'
          ? '/api/subscription/creem/pay'
          : '/api/subscription/epay/pay'

  const response = await desktopEnvelope<{
    pay_link?: string
    checkout_url?: string
    notice?: string
  }>({
    method: 'POST',
    path,
    body: {
      plan_id: planId,
      payment_method: paymentMethod,
    },
  })

  if (!response.success) {
    throw new Error(response.message || '购买失败')
  }

  return response.data
}
