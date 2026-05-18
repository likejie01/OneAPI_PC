export interface ApiEnvelope<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface UserProfile {
  id: number
  username: string
  display_name: string
  role: number
  status: number
  email?: string
  group: string
  quota: number
  used_quota: number
  request_count: number
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  aff_history_quota?: number
  setting?: string
  sidebar_modules?: string
  permissions?: Record<string, unknown>
}

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  password: string
  email?: string
  verification_code?: string
  aff?: string
  turnstile?: string
}

export interface LoginResult {
  require_2fa?: boolean
  id?: number
}

export interface AuthStatus {
  register_enabled?: boolean
  password_register_enabled?: boolean
  email_verification?: boolean
  user_agreement_enabled?: boolean
  privacy_policy_enabled?: boolean
}

export interface AssistantRecord {
  id: string
  name: string
  description: string
  prompt: string
  model: string
  temperature: number
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: number
  imageUrl?: string
  imagePrompt?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface ChatModelOption {
  label: string
  value: string
}

export interface ChatGroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export interface ChatCompletionResponse {
  id: string
  model: string
  choices: Array<{
    message: {
      role: 'assistant'
      content: string
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface ImageGenerationResponse {
  created?: number
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export interface SubscriptionPlan {
  id: number
  title: string
  subtitle?: string
  price_amount: number
  currency: string
  duration_unit: 'year' | 'month' | 'day' | 'hour' | 'custom'
  duration_value: number
  total_amount: number
  enabled: boolean
}

export interface PlanRecord {
  plan: SubscriptionPlan
}

export interface SubscriptionSelfData {
  billing_preference?: string
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
}

export interface UserSubscription {
  id: number
  plan_id: number
  status: string
  start_time: number
  end_time: number
  amount_total: number
  amount_used: number
  next_reset_time?: number
}

export interface UserSubscriptionRecord {
  subscription: UserSubscription
}

export interface SubscriptionPaymentInfo {
  enable_epay_payment: boolean
  enable_stripe_payment: boolean
  enable_creem_payment: boolean
  enable_wallet_payment?: boolean
  pay_methods: Array<{
    name: string
    type: string
    color?: string
    min_topup?: number
    icon?: string
  }>
}

export interface TopupInfo {
  enable_online_topup: boolean
  enable_stripe_topup: boolean
  pay_methods: Array<{
    name: string
    type: string
    color?: string
    min_topup?: number
    icon?: string
  }>
  min_topup: number
  stripe_min_topup: number
  amount_options: number[]
  discount: Record<number, number>
  topup_link?: string
}

export interface BillingRecord {
  id: number
  amount: number
  money: number
  trade_no: string
  payment_method: string
  create_time: number
  complete_time?: number
  status: 'success' | 'pending' | 'expired'
}

export interface BillingHistoryData {
  items: BillingRecord[]
  total: number
  page?: number
  page_size?: number
}

export interface UsageLog {
  id: number
  type: number
  model_name?: string
  token_name?: string
  quota: number
  created_at?: number
  created_time?: number
  prompt_tokens?: number
  completion_tokens?: number
  multiplier?: string
}

export interface UsageStat {
  quota: number
  rpm: number
  tpm: number
}

export interface UsageData {
  items: UsageLog[]
  total: number
  page?: number
  page_size?: number
}

export interface ApiKeyRecord {
  id: number
  name: string
  key: string
  status: number
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  expired_time: number
  created_time: number
  accessed_time: number
  group?: string
}

export interface ApiKeyPageData {
  items: ApiKeyRecord[]
  total: number
  page: number
  page_size: number
}

export interface ApiKeyFormInput {
  name: string
  remain_quota: number
  expired_time: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string
  group: string
  cross_group_retry: boolean
}
