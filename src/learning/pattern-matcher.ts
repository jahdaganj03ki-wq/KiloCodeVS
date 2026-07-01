import type { DetectedFailure, Lesson } from "./lesson-types"

export interface PatternRule {
  id: string
  errorPattern: RegExp
  shellType?: string
  os?: string
  suggestedCorrection: string
  correctionContext: string
}

export const BUILTIN_PATTERNS: PatternRule[] = [
  {
    id: "powershell-and",
    errorPattern: /&&/,
    shellType: "powershell",
    suggestedCorrection: ";",
    correctionContext: "PowerShell uses semicolon (;) instead of && to chain commands sequentially",
  },
  {
    id: "powershell-or",
    errorPattern: /\|\|/,
    shellType: "powershell",
    suggestedCorrection: "; if (-not $?) { }",
    correctionContext: "PowerShell uses 'if (-not $?)' instead of || for conditional execution",
  },
  {
    id: "powershell-env-var",
    errorPattern: /\$[A-Z_][A-Z0-9_]*/,
    shellType: "powershell",
    suggestedCorrection: "$env:VARNAME",
    correctionContext: "PowerShell uses $env:VARNAME instead of $VARNAME for environment variables",
  },
  {
    id: "cmd-env-var",
    errorPattern: /\$[A-Z_][A-Z0-9_]*/,
    shellType: "cmd",
    suggestedCorrection: "%VARNAME%",
    correctionContext: "Windows cmd uses %VARNAME% instead of $VARNAME for environment variables",
  },
  {
    id: "powershell-which",
    errorPattern: /which /,
    shellType: "powershell",
    suggestedCorrection: "Get-Command",
    correctionContext: "PowerShell uses Get-Command instead of 'which' to locate executables",
  },
  {
    id: "powershell-cat",
    errorPattern: /^cat /,
    shellType: "powershell",
    suggestedCorrection: "Get-Content",
    correctionContext: "PowerShell uses Get-Content (or gc, type) instead of 'cat'",
  },
  {
    id: "powershell-touch",
    errorPattern: /^touch /,
    shellType: "powershell",
    suggestedCorrection: "New-Item -ItemType File",
    correctionContext: "PowerShell uses New-Item instead of 'touch' to create empty files",
  },
  {
    id: "powershell-grep",
    errorPattern: /grep /,
    shellType: "powershell",
    suggestedCorrection: "Select-String",
    correctionContext: "PowerShell uses Select-String instead of 'grep'",
  },
  {
    id: "cmd-which",
    errorPattern: /which /,
    shellType: "cmd",
    suggestedCorrection: "where",
    correctionContext: "Windows cmd uses 'where' instead of 'which' to locate executables",
  },
  {
    id: "unix-path-windows",
    errorPattern: /\/[a-z]+\/[a-z]/,
    os: "windows",
    shellType: "powershell",
    suggestedCorrection: "C:\\path\\to\\file",
    correctionContext: "Windows uses backslash paths (C:\\Users\\...) not forward-slash paths",
  },
  {
    id: "powershell-backtick",
    errorPattern: /`[a-z]/,
    shellType: "powershell",
    suggestedCorrection: "Remove backticks or use proper PowerShell escaping",
    correctionContext: "In PowerShell, backtick (`) is the escape character, not a command substitution like in bash",
  },
]

export function matchBuiltinPattern(failure: DetectedFailure): PatternRule | null {
  const cmd = failure.command
  for (const rule of BUILTIN_PATTERNS) {
    if (rule.shellType && rule.shellType !== failure.shellType) continue
    if (rule.os && rule.os !== failure.os) continue
    if (rule.errorPattern.test(cmd)) return rule
  }
  return null
}

export function matchLearnedPattern(failure: DetectedFailure, lessons: Lesson[]): Lesson | null {
  const cmd = failure.command
  for (const lesson of lessons) {
    if (lesson.confidence < 0.3) continue
    if (lesson.shellType && lesson.shellType !== failure.shellType) continue
    if (lesson.os && lesson.os !== failure.os) continue
    if (cmd.includes(lesson.observedError.slice(0, 20))) return lesson
  }
  return null
}

export function generateLesson(
  failure: DetectedFailure,
  correction?: string,
  correctionContext?: string,
): Omit<Lesson, "id" | "created" | "updated" | "frequency" | "confidence" | "lastApplied" | "timesApplied"> {
  const builtin = matchBuiltinPattern(failure)
  return {
    observedError: failure.errorMessage,
    errorContext: failure.context,
    shellType: (failure.shellType || "unknown") as "powershell" | "bash" | "cmd" | "unknown",
    os: (failure.os || "unknown") as "windows" | "linux" | "macos",
    correction: correction || builtin?.suggestedCorrection || "Review and fix the command syntax",
    correctionContext: correctionContext || builtin?.correctionContext || "Previous attempt failed due to command error",
    source: "auto-detected",
  }
}
