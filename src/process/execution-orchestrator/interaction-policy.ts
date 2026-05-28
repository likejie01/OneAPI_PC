export type InteractionDecision = 'manual' | 'auto_approve'

const AUTO_APPROVE_COMMAND_PATTERNS = [
  /\bdir\b/i,
  /\bls\b/i,
  /\bcat\b/i,
  /\btype\b/i,
  /\bGet-Content\b/i,
  /\brg\b/i,
  /\bfindstr\b/i,
  /\bgit status\b/i,
  /\bgit diff\b/i,
  /\bpwd\b/i,
]

export function resolveInteractionDecision(input: {
  fullAccess: boolean
  autoApproveEligible: boolean
  command?: string
}): InteractionDecision {
  if (!input.autoApproveEligible || !input.fullAccess) {
    return 'manual'
  }
  const command = input.command?.trim() || ''
  if (!command) {
    return 'auto_approve'
  }
  return AUTO_APPROVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
    ? 'auto_approve'
    : 'manual'
}
