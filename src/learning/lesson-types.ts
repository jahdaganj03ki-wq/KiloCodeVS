export interface Lesson {
  id: string
  created: number
  updated: number
  frequency: number
  confidence: number

  observedError: string
  errorContext: string
  shellType?: "powershell" | "bash" | "cmd" | "unknown"
  os?: "windows" | "linux" | "macos"

  correction: string
  correctionContext: string

  source: "auto-detected" | "verified" | "user-confirmed"
  lastApplied: number
  timesApplied: number
}

export interface LessonStoreData {
  version: 1
  lessons: Lesson[]
  metadata: {
    totalFailures: number
    totalLessons: number
    lastCleanup: number
  }
}

export interface ExecutionResult {
  command: string
  exitCode?: number
  stdout: string
  stderr: string
  shellType?: string
  os?: string
  success: boolean
}

export interface DetectedFailure {
  command: string
  errorMessage: string
  shellType?: string
  os?: string
  context: string
  confidence: number
}

export interface LearningContext {
  os: string
  shellType: string
  recentFailures: DetectedFailure[]
  relevantLessons: Lesson[]
}

export const LESSON_STORE_VERSION = 1
export const MAX_LESSONS = 500
export const MIN_CONFIDENCE = 0.2
export const DEFAULT_CONFIDENCE = 0.5
