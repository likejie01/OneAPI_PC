import { desktopEnvelope } from '../lib/desktop-client'
import type { BillingHistoryData, TopupInfo } from '../shared/contracts'

export async function getTopupInfo() {
  const response = await desktopEnvelope<TopupInfo>({
    method: 'GET',
    path: '/api/user/topup/info',
  })
  return response.data
}

export async function redeemTopupCode(code: string) {
  const response = await desktopEnvelope<number>({
    method: 'POST',
    path: '/api/user/topup',
    body: { key: code },
  })

  if (!response.success) {
    throw new Error(response.message || '兑换失败')
  }

  return response.data
}

export async function requestWalletPayment(amount: number, paymentMethod: string) {
  const response = await desktopEnvelope<{
    url?: string
  }>({
    method: 'POST',
    path: '/api/user/pay',
    body: {
      amount,
      payment_method: paymentMethod,
    },
  })

  if (!response.success) {
    throw new Error(response.message || '拉起支付失败')
  }

  return response.data
}

export async function getBillingHistory(page = 1, pageSize = 8) {
  const response = await desktopEnvelope<BillingHistoryData>({
    method: 'GET',
    path: '/api/user/topup/self',
    query: {
      p: page,
      page_size: pageSize,
    },
  })
  return response.data
}
