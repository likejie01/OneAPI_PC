import { useMemo, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { DESKTOP_COMPLIANCE_SECTION_IDS, type DesktopComplianceSectionId } from '../../domains/compliance'
import { LazyMarkdownContent } from '../assistants/AssistantWorkspaceSupport'

export type DesktopLegalDocuments = Partial<Record<DesktopComplianceSectionId, string>>

type ComplianceLegalModalProps = {
  required: boolean
  loading?: boolean
  documents: DesktopLegalDocuments
  onClose: () => void
  onReject?: () => void
  onAccept?: () => void
}

const fallbackDocuments: Record<DesktopComplianceSectionId, { title: string; summary: string; body: string }> = {
  'user-agreement': {
    title: '用户协议',
    summary: '账号准入、API Key、充值用量、客户端联动和平台处置规则。',
    body:
      '账号准入：本服务当前面向人工审核通过或管理员授权的用户开放。用户通过平台公告、AI 开发群或其他指定渠道提交申请后，由管理员根据使用目的、风险情况和运营规则创建或启用账号。\n\n' +
      '账号安全：用户应保证注册、联系和审核材料真实、合法、可联系，并妥善保管账号、密码、访问令牌、API Key、客户端绑定信息和设备。因泄露、共享、转售、出租、出借、嵌入公开仓库或交由不可信第三方使用导致的损失和责任，由用户自行承担。\n\n' +
      '使用边界：用户不得转售、分发、出租平台服务或 API Key，不得批量注册、绕过额度限制、破解客户端、伪造请求来源、攻击平台、干扰计费、滥用优惠、抓取非授权数据、规避内容安全或协助他人违反平台规则。\n\n' +
      '费用与额度：充值金额用于购买平台内部系统货币、额度、套餐或会员服务。实际扣费以服务端订单、支付机构通知、模型计费规则、倍率配置和平台账务记录为准。除法律另有规定或平台明确承诺外，已消耗额度不退还。\n\n' +
      '合规义务：用户应遵守法律法规、公序良俗、平台规则、上游模型服务商政策、开源许可证和第三方 API 规则，不得使用本服务从事违法犯罪、侵权、欺诈、垃圾信息、恶意自动化、未经授权数据抓取、网络攻击、侵犯隐私或其他被禁止活动。',
  },
  'privacy-policy': {
    title: '隐私政策',
    summary: '说明个人信息、会话附件、第三方模型传输和用户权利。',
    body:
      '处理目的：为提供账号登录、AI 会话、模型接口、附件处理、客户端绑定、App 同步、支付充值、用量统计、安全审核、投诉处理、故障排查和系统运营能力，平台会在必要范围内处理与服务有关的信息。\n\n' +
      '信息类型：平台可能处理账号信息、联系方式、角色权限、登录状态、IP、设备与客户端信息、API Key 元数据、调用记录、订单记录、余额、用量、输入内容、附件、图片、代码、会话上下文、执行日志、安全事件和管理员操作记录。\n\n' +
      '最小必要：平台仅在实现服务、安全、计费、风控、合规和争议处理所需范围内处理信息，并采取合理措施减少完整提示词、密钥、隐私、附件内容和敏感字段的不必要留存。\n\n' +
      '第三方处理：用户提交给模型的输入、附件、图片、会话内容和执行日志可能会发送给第三方或境外模型服务商处理。支付相关信息可能由支付机构处理，文件、日志和监控信息可能由云服务、安全组件或运维工具处理。',
  },
  'generative-ai-service': {
    title: '生成式 AI 服务说明',
    summary: '说明服务性质、模型来源、第三方处理、输出风险和使用边界。',
    body:
      '服务定位：本服务面向经人工审核或平台授权的用户开放，提供模型接口中转、AIChat、API Key 管理、用量与余额管理、附件辅助处理、客户端联动、会话同步、执行日志与必要运营配置能力。\n\n' +
      '模型来源：平台不自研、不训练、不微调基础大模型。所有文本、图片、代码、多模态或工具调用能力均由平台已配置的第三方或上游模型服务提供。\n\n' +
      '数据流转：用户通过网页、桌面客户端、Android App、API、插件或自动化工具提交的提示词、附件、图片、代码、上下文、模型参数、工具调用参数和执行日志，可能会被转发给第三方模型服务商、云服务商或境外服务商处理。\n\n' +
      '输出风险：生成式 AI 输出可能存在事实错误、遗漏、偏见、过时、不完整、不可复现或与用户意图不一致等问题。高风险场景必须由具备相应资质或责任的人员复核后再使用。',
  },
  report: {
    title: '投诉举报入口',
    summary: '投诉举报范围、处理材料、处理承诺和外部举报渠道。',
    body:
      '受理范围：用户、权利人或公众可就违法内容、权利侵害、个人信息处理、未成年人保护、账号滥用、API Key 泄露、计费订单、模型安全、客户端联动异常、服务不可用或其他平台问题提交投诉举报。\n\n' +
      '材料要求：为便于核查，请提供账号或联系方式、订单号或请求 ID、API Key 名称、模型名称、发生时间、页面或客户端位置、问题描述、影响范围和必要证据。请勿提交无关身份证件、银行卡、密码、私钥、完整 API Key 或商业秘密。\n\n' +
      '处理流程：平台收到投诉举报后会进行登记、初步分级、证据核查、必要的账号或请求定位、处理决定和结果反馈。违法犯罪、人身安全、未成年人、个人信息泄露、账号盗用、支付争议和大面积服务异常将优先处理。',
  },
  'content-safety': {
    title: '内容安全规则',
    summary: '区分违规与违法意图，说明截停、放行和封禁升级规则。',
    body:
      '审核范围：平台会在服务端对提示词、附件文本、会话请求、API 调用、异常重试、规避行为和投诉线索进行内容安全审核。审核目标是识别明确违法意图、高危险实施请求、恶意绕过、接口滥用、侵犯他人权益和可能引发重大风险的内容。\n\n' +
      '限制类违法或危险意图：包括请求可执行犯罪步骤、工具、代码、采购渠道、攻击目标、隐匿方法、规避追责、实施方案，或明确寻求危害国家安全、暴恐极端、爆炸物/毒品制作采购、网络攻击、凭据窃取、诈骗洗钱、侵犯隐私等帮助。\n\n' +
      '允许的安全语境：法律教育、危害说明、风险防范、新闻讨论、政策分析、合规咨询、受害者支持、防御性安全研究、历史研究和科普内容，在不请求可执行违法步骤、不鼓励实施、不规避监管的情况下可以放行。\n\n' +
      '规避处理：用户不得通过拆分请求、编码混淆、角色扮演伪装、跨语言替换、外部插件、第三方 API 或批量自动化方式规避审核。',
  },
}

export function ComplianceLegalModal(props: ComplianceLegalModalProps) {
  const { required, loading, documents, onClose, onReject, onAccept } = props
  const [activeSectionId, setActiveSectionId] = useState<DesktopComplianceSectionId>('user-agreement')
  const [readSections, setReadSections] = useState<DesktopComplianceSectionId[]>(['user-agreement'])
  const allRead = DESKTOP_COMPLIANCE_SECTION_IDS.every((sectionId) => readSections.includes(sectionId))

  const activeSection = fallbackDocuments[activeSectionId]
  const activeContent = useMemo(() => {
    const remote = documents[activeSectionId]?.trim()
    return remote || `## ${activeSection.title}\n\n${activeSection.body}`
  }, [activeSection.body, activeSection.title, activeSectionId, documents])

  function activateSection(sectionId: DesktopComplianceSectionId) {
    setActiveSectionId(sectionId)
    setReadSections((current) => current.includes(sectionId) ? current : [...current, sectionId])
  }

  return (
    <div className='modal-mask' onClick={() => { if (!required) onClose() }}>
      <div className='modal-card legal-compliance-modal' role='dialog' aria-modal='true' onClick={(event) => event.stopPropagation()}>
        <div className='legal-compliance-head'>
          <div>
            <span className='eyebrow dark'>隐私与合规</span>
            <h2>{required ? '请阅读并同意协议' : '隐私与合规'}</h2>
            <p>
              {required
                ? '首次登录客户端需要确认协议、隐私政策、生成式 AI 服务说明、投诉举报入口和内容安全规则。'
                : '查看用户协议、隐私政策、生成式 AI 服务说明、投诉举报入口和内容安全规则。'}
            </p>
          </div>
          {!required ? (
            <button className='ghost-button icon-only tiny' type='button' onClick={onClose} aria-label='关闭隐私与合规' title='关闭'>
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className='legal-compliance-layout'>
          <div className='legal-compliance-tabs' role='tablist' aria-label='隐私与合规标签'>
            {DESKTOP_COMPLIANCE_SECTION_IDS.map((sectionId) => {
              const section = fallbackDocuments[sectionId]
              const active = sectionId === activeSectionId
              const read = readSections.includes(sectionId)
              return (
                <button
                  key={sectionId}
                  type='button'
                  role='tab'
                  aria-selected={active}
                  className={`legal-compliance-tab ${active ? 'active' : ''}`}
                  onClick={() => activateSection(sectionId)}
                >
                  <span>{section.title}</span>
                  {read ? <CheckCircle2 size={14} /> : null}
                </button>
              )
            })}
          </div>
          <div className='legal-compliance-panel'>
            <div className='legal-compliance-panel-head'>
              <h3>{activeSection.title}</h3>
              <p>{activeSection.summary}</p>
            </div>
            <div className='legal-compliance-document'>
              <LazyMarkdownContent content={activeContent} className='announcement-markdown' />
            </div>
          </div>
        </div>

        <div className='modal-actions legal-compliance-actions'>
          {required ? (
            <>
              <button className='secondary-button danger' type='button' onClick={onReject}>
                不同意
              </button>
              <button className='primary-button' type='button' disabled={loading || !allRead} onClick={onAccept}>
                {loading ? '确认中...' : `同意并进入 (${readSections.length}/${DESKTOP_COMPLIANCE_SECTION_IDS.length})`}
              </button>
            </>
          ) : (
            <button className='primary-button' type='button' onClick={onClose}>
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
