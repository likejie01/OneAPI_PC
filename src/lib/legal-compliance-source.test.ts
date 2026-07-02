import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSource = readFileSync(resolve(srcRoot, 'App.tsx'), 'utf8')
const complianceDomainSource = readFileSync(resolve(srcRoot, 'domains', 'compliance.ts'), 'utf8')
const complianceModalSource = readFileSync(resolve(srcRoot, 'features', 'compliance', 'ComplianceLegalModal.tsx'), 'utf8')
const assistantSupportSource = readFileSync(resolve(srcRoot, 'features', 'assistants', 'AssistantWorkspaceSupport.tsx'), 'utf8')
const modalsStylesSource = readFileSync(resolve(srcRoot, 'styles', 'modals.css'), 'utf8')
const polishStylesSource = readFileSync(resolve(srcRoot, 'styles', 'polish.css'), 'utf8')
const readmeSource = readFileSync(resolve(srcRoot, '..', 'README.md'), 'utf8')

test('desktop sidebar exposes renamed settings and wallet entries without a privacy side tab', () => {
  assert.match(appSource, /type SideTab = 'assistants' \| 'subscriptions' \| 'wallet' \| 'service-status' \| 'me'/)
  assert.match(appSource, /\{ key: 'wallet', label: '钱包用量'/)
  assert.match(appSource, /\{ key: 'me', label: '系统设置'/)
  assert.doesNotMatch(appSource, /\{ key: 'privacy'/)
  assert.doesNotMatch(appSource, /label: '隐私合规'/)
  assert.doesNotMatch(appSource, /sideTab === 'privacy'/)
  assert.doesNotMatch(appSource, /label: '用量账单'/)
  assert.doesNotMatch(appSource, /label: '环境部署'/)
})

test('desktop project selection and new cli sessions require the safety notice first with three actions', () => {
  assert.match(appSource, /type SafetyNoticeIntent = 'new-session' \| 'pick-project'/)
  assert.match(appSource, /requestSafetyNoticeBeforeProjectSelection/)
  assert.match(appSource, /onClick=\{\(\) => requestSafetyNoticeBeforeProjectSelection\(\)\}/)
  assert.match(appSource, /confirmSafetyNoticeAndContinue[\s\S]*?safetyNoticeIntent === 'pick-project'[\s\S]*?await pickAndCreateProjectSession\(\)/)
  assert.match(appSource, /DESKTOP_SAFETY_NOTICE_DISMISSED_KEY/)
  assert.match(appSource, /dismissSafetyNoticeAndContinue/)
  assert.match(appSource, /不再提示/)
  assert.match(appSource, /已知晓/)
  assert.match(modalsStylesSource, /\.compliance-safety-actions[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(appSource, /onClick=\{\(\) => void handlePickProject\(\)\}/)
})

test('desktop legal center mirrors app compliance tabs and first-login confirmation flow', () => {
  assert.match(complianceModalSource, /用户协议/)
  assert.match(complianceModalSource, /隐私政策/)
  assert.match(complianceModalSource, /生成式 AI 服务说明/)
  assert.match(complianceModalSource, /内容安全规则/)
  assert.match(complianceModalSource, /activeSectionId/)
  assert.match(complianceModalSource, /required \? '请阅读并同意协议' : '隐私与合规'/)
  assert.match(appSource, /legalModalOpen/)
  assert.match(appSource, /legalModalRequired/)
  assert.match(appSource, /queueLegalAcceptanceCheck\(user\)/)
  assert.match(appSource, /handleRejectLegalAcceptance/)
  assert.match(appSource, /handleAcceptLegalCompliance/)
  assert.match(appSource, /showLegalCenterFromUserMenu/)
  assert.match(appSource, /关于隐私/)
  assert.match(modalsStylesSource, /\.desktop-notice-section-privacy/)
  assert.match(appSource, /fetchComplianceStatus\(\)/)
  assert.match(appSource, /acknowledgeCompliance\(/)
})

test('desktop compliance domain uses server legal and compliance endpoints', () => {
  assert.match(complianceDomainSource, /path: '\/api\/user\/compliance\/status'/)
  assert.match(complianceDomainSource, /path: '\/api\/user\/compliance\/acknowledge'/)
  assert.match(complianceDomainSource, /path: '\/api\/user-agreement'/)
  assert.match(complianceDomainSource, /path: '\/api\/privacy-policy'/)
  assert.match(complianceDomainSource, /normalizeLegalDocumentText/)
})

test('desktop compliance modal has a bounded tabbed layout for legal text', () => {
  assert.match(modalsStylesSource, /\.legal-compliance-modal/)
  assert.match(modalsStylesSource, /\.legal-compliance-tabs/)
  assert.match(modalsStylesSource, /\.legal-compliance-document/)
  assert.match(modalsStylesSource, /max-height:\s*min\(58vh, 520px\)/)
})

test('all modal and picker surfaces share the final blurred backdrop pass', () => {
  const blurPassIndex = polishStylesSource.indexOf('/* Final popup blur pass')
  const performancePassIndex = polishStylesSource.indexOf('/* Final performance pass')

  assert.ok(blurPassIndex >= 0)
  assert.ok(performancePassIndex > blurPassIndex)
  assert.match(polishStylesSource.slice(blurPassIndex, performancePassIndex), /\.modal-mask,[\s\S]*?\.image-preview-modal-mask[\s\S]*?backdrop-filter:\s*blur\(28px\) saturate\(145%\) !important/)
  assert.match(polishStylesSource.slice(blurPassIndex, performancePassIndex), /body:has\(\.picker-menu\)::after/)
  assert.match(polishStylesSource.slice(blurPassIndex, performancePassIndex), /body:has\(\.assistant-menu\)::after/)
  assert.match(polishStylesSource.slice(blurPassIndex, performancePassIndex), /body:has\(\.model-menu\)::after/)
  assert.match(polishStylesSource.slice(performancePassIndex), /:root\[data-performance-mode='efficiency'\] \*,[\s\S]*?backdrop-filter:\s*none !important/)
})

test('cli extension palette uses fixed Chinese tab labels', () => {
  assert.match(assistantSupportSource, /getCliPaletteTabLabel/)
  assert.match(assistantSupportSource, /return '命令'/)
  assert.match(assistantSupportSource, /return '技能'/)
  assert.match(assistantSupportSource, /return '插件'/)
  assert.match(assistantSupportSource, /const CLI_PALETTE_TAB_ORDER: CliPaletteTab\[\] = \['command', 'skill', 'plugin'\]/)
  assert.match(assistantSupportSource, /disabled=\{disabled\}/)
  assert.doesNotMatch(assistantSupportSource, /<span>\{tab\}<\/span>/)
})

test('readme promotes ai.oneapi.center without local screenshot dependencies', () => {
  assert.match(readmeSource, /\[中文\]\(#中文\) \| \[English\]\(#english\)/)
  assert.match(readmeSource, /https:\/\/ai\.oneapi\.center/)
  assert.doesNotMatch(readmeSource, /images\/Snipaste_/)
  assert.doesNotMatch(readmeSource, /images\/PixPin_/)
  assert.match(readmeSource, /界面范围/)
  assert.match(readmeSource, /Interface Scope/)
  assert.match(readmeSource, /Privacy and compliance/)
})
