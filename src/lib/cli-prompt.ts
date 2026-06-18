import {
  buildFinalPrompt,
  CLI_EXECUTION_POLICY,
  extractUserTaskFromFinalPrompt,
} from '../process/prompt-assembler/build-final-prompt.ts'

export { CLI_EXECUTION_POLICY }

export function extractCliUserTask(raw: string) {
  return extractUserTaskFromFinalPrompt(raw)
}

export function buildCliExecutionPrompt(prompt: string, options: {
  fullAccess?: boolean
  projectPath?: string
} = {}) {
  return buildFinalPrompt({
    prompt,
    client: 'codex',
    fullAccess: options.fullAccess,
    projectPath: options.projectPath,
  }).finalPrompt
}
