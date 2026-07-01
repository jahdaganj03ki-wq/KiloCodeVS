import type { ExecutionResult, DetectedFailure } from "./lesson-types"

const EXIT_CODE_FAILURE = "exit-code"
const STDERR_PATTERN = "stderr-pattern"
const AI_ANALYSIS = "ai-analysis"

const knownErrorPatterns: Array<{ pattern: RegExp; shellTypes?: string[]; os?: string[] }> = [
  // PowerShell-specific errors
  { pattern: /&& was unexpected/i, shellTypes: ["powershell"] },
  { pattern: /the token '&&' is not a valid/i, shellTypes: ["powershell"] },
  { pattern: /|| was unexpected/i, shellTypes: ["powershell"] },
  { pattern: /'&&' is not recognized/i, shellTypes: ["powershell", "cmd"] },
  { pattern: /'[^']+' is not recognized as an internal or external command/i, shellTypes: ["powershell", "cmd"] },
  { pattern: /The term '[^']+' is not recognized as the name of a cmdlet/i, shellTypes: ["powershell"] },

  // General command errors
  { pattern: /command not found/i },
  { pattern: /No such file or directory/i },
  { pattern: /Permission denied/i },
  { pattern: /Cannot find (path|file)/i },
  { pattern: /is not a valid command/i },
  { pattern: /SyntaxError/i },
  { pattern: /fatal:/i },
  { pattern: /Error:/i },

  // npm/pip specific
  { pattern: /npm ERR!/i },
  { pattern: /ERR_PNPM/i },
  { pattern: /pip.*(error|failed)/i },
  { pattern: /ModuleNotFoundError/i },

  // Compilation errors
  { pattern: /error:.*expected/i },
  { pattern: /undefined reference to/i },
  { pattern: /cannot find symbol/i },
]

const warningNoisePatterns = [
  /^npm notice/i,
  /^npm warn/i,
  /^warning:/i,
  /DeprecationWarning/i,
  /ExperimentalWarning/i,
]

export function detectFailure(result: ExecutionResult): DetectedFailure | null {
  if (!result.command) return null

  const errorMessage = extractErrorMessage(result)
  if (!errorMessage) return null

  const context = inferContext(result.command)
  let confidence = 0

  if (result.exitCode !== undefined && result.exitCode !== 0) {
    confidence = Math.max(confidence, 0.8)
  }

  for (const entry of knownErrorPatterns) {
    if (entry.pattern.test(result.stderr) || entry.pattern.test(result.stdout)) {
      confidence = Math.max(confidence, 0.9)
      break
    }
  }

  if (confidence === 0) return null

  return {
    command: result.command,
    errorMessage,
    shellType: result.shellType,
    os: result.os,
    context,
    confidence,
  }
}

export function needsAIAnalysis(result: ExecutionResult): boolean {
  if (result.exitCode !== 0) return false
  if (!result.stderr && !result.stdout) return false

  const cleanStderr = result.stderr
    .split("\n")
    .filter((line) => !warningNoisePatterns.some((p) => p.test(line)))
    .join("\n")
    .trim()

  if (!cleanStderr) return false

  return knownErrorPatterns.some((entry) => entry.pattern.test(cleanStderr))
}

function extractErrorMessage(result: ExecutionResult): string | null {
  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()

  for (const source of [stderr, stdout]) {
    if (!source) continue
    const lines = source.split("\n").filter((l) => l.trim())
    for (const line of lines) {
      const trimmed = line.trim()
      if (warningNoisePatterns.some((p) => p.test(trimmed))) continue
      if (trimmed.length < 10) continue
      if (trimmed.length > 200) return trimmed.slice(0, 200) + "..."
      return trimmed
    }
  }
  return null
}

function inferContext(command: string): string {
  const lower = command.toLowerCase()

  if (/^git\s/.test(command)) return "git"
  if (/^npm\s/.test(command)) return "npm"
  if (/^npx\s/.test(command)) return "npx"
  if (/^pip\s/.test(command)) return "pip"
  if (/^cargo\s/.test(command)) return "cargo"
  if (lower.includes("install")) return "install"
  if (lower.includes("build")) return "build"
  if (lower.includes("test")) return "test"
  if (lower.includes("deploy")) return "deploy"
  if (lower.includes("docker")) return "docker"

  return "shell-command"
}
