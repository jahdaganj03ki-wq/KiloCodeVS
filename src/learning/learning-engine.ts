import * as vscode from "vscode"
import { LessonStore } from "./lesson-store"
import { detectFailure, needsAIAnalysis } from "./failure-detector"
import { matchBuiltinPattern, generateLesson } from "./pattern-matcher"
import { buildLearningPrompt } from "./system-prompt-builder"
import type { ExecutionResult, Lesson } from "./lesson-types"

export class LearningEngine implements vscode.Disposable {
  private store: LessonStore
  private disposables: vscode.Disposable[] = []
  private lastMaintenance = 0
  private readonly maintenanceInterval = 24 * 60 * 60 * 1000

  constructor(context: vscode.ExtensionContext) {
    this.store = new LessonStore(context)
    void this.store.load().then(() => {
      this.checkMaintenance()
    })
  }

  async onExecutionResult(result: ExecutionResult): Promise<void> {
    const failure = detectFailure(result)
    if (!failure) return

    this.store.recordFailure()

    const builtin = matchBuiltinPattern(failure)
    if (builtin) {
      this.store.addOrUpdate(
        generateLesson(failure, builtin.suggestedCorrection, builtin.correctionContext),
      )
      return
    }

    const learned = this.store.getRelevant(result.os, result.shellType, 5)
    const matchedLearned = learned.find(
      (l) => result.command.includes(l.observedError.slice(0, 20)),
    )
    if (matchedLearned) {
      this.store.updateConfidence(matchedLearned.id, false)
      return
    }

    if (needsAIAnalysis(result)) {
      this.store.addOrUpdate(
        generateLesson(failure),
      )
    }
  }

  async onAIFeedback(feedback: {
    command: string
    success: boolean
    notes?: string
  }): Promise<void> {
    if (feedback.success) {
      const lessons = this.store.getAll()
      for (const lesson of lessons) {
        if (feedback.command.includes(lesson.observedError.slice(0, 20))) {
          this.store.updateConfidence(lesson.id, true)
          return
        }
      }
    }
  }

  async getLearningPrompt(os: string, shellType: string): Promise<string> {
    const lessons = this.store.getRelevant(os, shellType)
    if (lessons.length === 0) return ""
    return buildLearningPrompt(os, shellType, lessons)
  }

  getRelevantLessons(os: string, shellType: string): Lesson[] {
    return this.store.getRelevant(os, shellType)
  }

  getAllLessons(): Lesson[] {
    return this.store.getAll()
  }

  private async checkMaintenance(): Promise<void> {
    const now = Date.now()
    if (now - this.lastMaintenance < this.maintenanceInterval) return
    this.lastMaintenance = now
    await this.store.runMaintenance()
  }

  dispose(): void {
    this.store.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
