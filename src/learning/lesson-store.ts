import * as vscode from "vscode"
import {
  type Lesson,
  type LessonStoreData,
  MAX_LESSONS,
  MIN_CONFIDENCE,
  LESSON_STORE_VERSION,
} from "./lesson-types"

const STORE_FILENAME = "learned-lessons.json"
const saveDebounceMs = 5000

export class LessonStore {
  private lessons: Lesson[] = []
  private dirty = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private storagePath: string

  constructor(context: vscode.ExtensionContext) {
    this.storagePath = context.globalStorageUri.fsPath
  }

  private get filePath(): string {
    return `${this.storagePath}/${STORE_FILENAME}`
  }

  async load(): Promise<Lesson[]> {
    try {
      const uri = vscode.Uri.file(this.filePath)
      const data = await vscode.workspace.fs.readFile(uri)
      const decoded = new TextDecoder().decode(data)
      const store: LessonStoreData = JSON.parse(decoded)
      if (store.version === LESSON_STORE_VERSION && Array.isArray(store.lessons)) {
        this.lessons = store.lessons
      }
    } catch {
      // File doesn't exist yet, start with empty lessons
      this.lessons = []
    }
    return this.lessons
  }

  getAll(): Lesson[] {
    return this.lessons
  }

  addOrUpdate(input: Omit<Lesson, "id" | "created" | "updated" | "frequency" | "confidence" | "lastApplied" | "timesApplied">): Lesson {
    const existing = this.lessons.find(
      (l) =>
        l.observedError === input.observedError &&
        l.errorContext === input.errorContext &&
        l.shellType === input.shellType,
    )

    if (existing) {
      existing.frequency++
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.updated = Date.now()
      existing.correction = input.correction
      existing.correctionContext = input.correctionContext
      if (input.source === "verified" && existing.source === "auto-detected") {
        existing.source = "verified"
      }
      this.scheduleSave()
      return existing
    }

    const lesson: Lesson = {
      id: crypto.randomUUID(),
      created: Date.now(),
      updated: Date.now(),
      frequency: 1,
      confidence: 0.5,
      lastApplied: 0,
      timesApplied: 0,
      ...input,
    }
    this.lessons.push(lesson)
    this.prune()
    this.scheduleSave()
    return lesson
  }

  updateConfidence(lessonId: string, success: boolean): void {
    const lesson = this.lessons.find((l) => l.id === lessonId)
    if (!lesson) return
    if (success) {
      lesson.confidence = Math.min(1, lesson.confidence + 0.15)
    } else {
      lesson.confidence = Math.max(0, lesson.confidence - 0.1)
    }
    lesson.updated = Date.now()
    if (success) lesson.frequency++
    lesson.timesApplied++
    this.scheduleSave()
  }

  getRelevant(os?: string, shellType?: string, maxResults = 10): Lesson[] {
    const scored = this.lessons
      .filter(
        (l) =>
          l.confidence >= MIN_CONFIDENCE &&
          (!os || !l.os || l.os === os) &&
          (!shellType || !l.shellType || l.shellType === shellType),
      )
      .map((l) => ({
        lesson: l,
        score: l.confidence * Math.log(l.frequency + 1) * (l.timesApplied > 0 ? 1.1 : 1),
      }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, maxResults).map((s) => s.lesson)
  }

  recordFailure(): void {
    this.scheduleSave()
  }

  private prune(): void {
    if (this.lessons.length <= MAX_LESSONS) return
    this.lessons.sort((a, b) => {
      const scoreA = a.confidence * a.frequency
      const scoreB = b.confidence * b.frequency
      return scoreA - scoreB
    })
    this.lessons = this.lessons.slice(-MAX_LESSONS)
  }

  async runMaintenance(): Promise<void> {
    const before = this.lessons.length
    this.lessons = this.lessons.filter(
      (l) => !(l.confidence < MIN_CONFIDENCE && l.frequency < 3),
    )
    this.lessons.sort((a, b) => b.confidence - a.confidence)
    this.dirty = true
    await this.save()
    if (before !== this.lessons.length) {
      console.log(`[Learning] Pruned ${before - this.lessons.length} low-confidence lessons`)
    }
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, saveDebounceMs)
  }

  private async save(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    const store: LessonStoreData = {
      version: LESSON_STORE_VERSION,
      lessons: this.lessons,
      metadata: {
        totalFailures: this.lessons.reduce((sum, l) => sum + l.frequency, 0),
        totalLessons: this.lessons.length,
        lastCleanup: Date.now(),
      },
    }
    try {
      const dir = vscode.Uri.file(this.storagePath)
      await vscode.workspace.fs.createDirectory(dir)
      const uri = vscode.Uri.file(this.filePath)
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(store, null, 2)))
    } catch (err) {
      console.error("[Learning] Failed to save lessons:", err)
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.dirty) {
      void this.save()
    }
  }
}
