import type { Lesson } from "./lesson-types"

const MAX_PROMPT_LENGTH = 1500
const MAX_LESSONS_IN_PROMPT = 8

export function buildLearningPrompt(os: string, shellType: string, lessons: Lesson[]): string {
  const relevant = lessons.filter((l) => {
    if (l.os && l.os !== os) return false
    if (l.shellType && l.shellType !== shellType) return false
    return l.confidence >= 0.5
  })

  if (relevant.length === 0) return ""

  const shown = relevant.slice(0, MAX_LESSONS_IN_PROMPT)
  const totalCount = relevant.length

  const lines: string[] = []
  lines.push("## Lessons from Previous Sessions\n")
  lines.push("Based on past experience, the following patterns have been identified:")
  lines.push("")

  for (const lesson of shown) {
    let prefix = "- "
    if (lesson.shellType === "powershell") prefix += "[PowerShell] "
    else if (lesson.shellType === "cmd") prefix += "[Cmd] "
    else if (lesson.shellType === "bash") prefix += "[Bash] "

    prefix += `When ${lesson.errorContext}, avoid "${lesson.observedError.slice(0, 60)}". `
    prefix += `Use: ${lesson.correction}`
    if (lesson.correctionContext) prefix += ` (${lesson.correctionContext})`

    if (prefix.length > MAX_PROMPT_LENGTH) {
      prefix = prefix.slice(0, MAX_PROMPT_LENGTH - 3) + "..."
    }
    lines.push(prefix)
  }

  if (totalCount > shown.length) {
    lines.push(`\n... and ${totalCount - shown.length} more lessons learned from previous sessions.\n`)
  }

  lines.push("\nThese patterns were learned from observing command execution across sessions.")
  lines.push("Apply these learnings to avoid repeating past mistakes.")

  return lines.join("\n")
}

export function formatLessonForContext(lesson: Lesson): string {
  const parts: string[] = []
  if (lesson.shellType) parts.push(`[${lesson.shellType}]`)
  parts.push(lesson.errorContext)
  parts.push(`→ ${lesson.correction}`)
  return parts.join(" ")
}
