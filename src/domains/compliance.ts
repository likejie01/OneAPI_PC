import { desktopBridge, desktopEnvelope } from '../lib/desktop-client'
import type { ApiEnvelope } from '../shared/contracts'

export const DESKTOP_COMPLIANCE_SECTION_IDS = [
  'user-agreement',
  'privacy-policy',
  'generative-ai-service',
  'report',
  'content-safety',
] as const

export type DesktopComplianceSectionId = (typeof DESKTOP_COMPLIANCE_SECTION_IDS)[number]

export type DesktopComplianceStatus = {
  version: string
  required_sections?: string[]
  accepted: boolean
  accepted_at?: number
  accepted_sections?: string[]
  ban?: {
    active?: boolean
    until?: number
    permanent?: boolean
    reason?: string
  }
}

function getEnvelopeMessage(data: unknown, fallbackStatus: number) {
  if (typeof data === 'object' && data && 'message' in data && typeof data.message === 'string' && data.message.trim()) {
    return data.message
  }
  return `请求失败（${fallbackStatus}）`
}

export function normalizeLegalDocumentText(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  if (/^https?:\/\//i.test(text)) {
    return `请在浏览器打开以下链接查看：\n${text}`
  }
  if (text.includes('<') && text.includes('>')) {
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return text
}

export function fetchComplianceStatus() {
  return desktopEnvelope<DesktopComplianceStatus>({
    method: 'GET',
    path: '/api/user/compliance/status',
  })
}

export function acknowledgeCompliance(input: { version: string; sections?: string[] }) {
  return desktopEnvelope<{ accepted: boolean; accepted_at?: number }>({
    method: 'POST',
    path: '/api/user/compliance/acknowledge',
    body: {
      version: input.version,
      sections: input.sections?.length ? input.sections : DESKTOP_COMPLIANCE_SECTION_IDS,
    },
  })
}

async function readLegalResponse(response: { ok: boolean; status: number; data: unknown }) {
  const data = response.data as ApiEnvelope<unknown>
  if (!response.ok) {
    throw new Error(getEnvelopeMessage(response.data, response.status))
  }
  return normalizeLegalDocumentText(data.data)
}

export async function fetchUserAgreement() {
  const response = await desktopBridge().request({
    method: 'GET',
    path: '/api/user-agreement',
  })
  return readLegalResponse(response)
}

export async function fetchPrivacyPolicy() {
  const response = await desktopBridge().request({
    method: 'GET',
    path: '/api/privacy-policy',
  })
  return readLegalResponse(response)
}
