import { desktopEnvelope } from '../lib/desktop-client'
import type { AlipayTopupCancel, AlipayTopupOrder, AlipayTopupStatus, BillingHistoryData, TopupInfo } from '../shared/contracts'

function isMissingAlipayRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('Invalid URL') && message.includes('/api/user/alipay/')
}

function formatAlipayRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (isMissingAlipayRouteError(error)) {
    return '当前服务地址未部署支付宝扫码充值接口，请切换到已部署支付宝接口的 OneAPI 服务后重试。'
  }
  return message || '支付宝充值请求失败'
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeAlipayTopupOrder(order: AlipayTopupOrder) {
  return {
    ...order,
    pay_url: order.pay_url ? decodeHtmlEntities(String(order.pay_url)).trim() : order.pay_url,
    checkout_url: order.checkout_url ? decodeHtmlEntities(String(order.checkout_url)).trim() : order.checkout_url,
  }
}

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

async function requestAlipayTopupOrder(path: string, amount: number) {
  const response = await desktopEnvelope<AlipayTopupOrder>({
    method: 'POST',
    path,
    body: {
      amount,
      platform: 'pc',
      pay_scene: 'pc_qr',
      pay_product: 'alipay.trade.precreate',
      payment_product: 'alipay.trade.precreate',
    },
  })

  if (!response.success && response.message !== 'success') {
    const message = typeof response.data === 'string' ? response.data : response.message
    throw new Error(message || '创建支付宝订单失败')
  }

  if (!response.data?.trade_no || !response.data.qr_code) {
    throw new Error('服务端未返回支付宝二维码。')
  }

  return normalizeAlipayTopupOrder(response.data)
}

export async function createAlipayTopupOrder(amount: number) {
  try {
    return await requestAlipayTopupOrder('/api/user/alipay/pay', amount)
  } catch (error) {
    throw new Error(formatAlipayRouteError(error))
  }
}

async function requestAlipayTopupStatus(path: string, tradeNo: string) {
  const response = await desktopEnvelope<AlipayTopupStatus>({
    method: 'GET',
    path,
    query: {
      trade_no: tradeNo,
    },
  })

  if (!response.success && response.message !== 'success') {
    throw new Error(response.message || '查询支付宝订单失败')
  }

  return response.data
}

export async function queryAlipayTopupOrder(tradeNo: string) {
  try {
    return await requestAlipayTopupStatus('/api/user/alipay/query', tradeNo)
  } catch (error) {
    throw new Error(formatAlipayRouteError(error))
  }
}

export async function cancelAlipayTopupOrder(tradeNo: string) {
  try {
    const response = await desktopEnvelope<AlipayTopupCancel>({
      method: 'POST',
      path: '/api/user/alipay/cancel',
      body: {
        trade_no: tradeNo,
      },
    })
    if (!response.success && response.message !== 'success') {
      throw new Error(response.message || '关闭支付宝订单失败')
    }
    return response.data
  } catch (error) {
    throw new Error(formatAlipayRouteError(error))
  }
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
