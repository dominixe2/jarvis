const DEFAULT_COMMANDS = [
  'npm test',
  'npm run test',
  'npm run build',
  'npm run lint',
  'npm run typecheck',
  'pnpm test',
  'pnpm run build',
  'pnpm run lint',
  'pnpm run typecheck',
  'yarn test',
  'yarn build',
  'yarn lint',
  'git status --short',
  'git diff --check',
]

export function allowedCommands() {
  const configured = (process.env.BUILDPILOT_ALLOWED_COMMANDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_COMMANDS, ...configured])
}

export function isAllowedCommand(command) {
  if (typeof command !== 'string') return false
  const normalised = command.trim().replace(/\s+/g, ' ')
  if (!normalised || /[;&|<>\x60\n\r]/.test(normalised)) return false
  if (normalised.includes('$(') || normalised.includes('${')) return false
  return allowedCommands().has(normalised)
}

export async function authorizeTool(toolName, input = {}) {
  if (['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(toolName)) {
    return { behavior: 'allow' }
  }
  if (toolName === 'Bash' && isAllowedCommand(input.command)) {
    return { behavior: 'allow' }
  }
  return {
    behavior: 'deny',
    message: 'BuildPilot policy blocked this tool or shell command. Add an exact reviewed command to BUILDPILOT_ALLOWED_COMMANDS if it is genuinely required.',
  }
}
