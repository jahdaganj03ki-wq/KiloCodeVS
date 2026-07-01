# Fork Plan: Kilo Code VS Code Extension with Puter.js Provider & Autonomous Learning

## Overview

Fork `packages/kilo-vscode` from [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) to create a custom VS Code extension with two major additions:

1. **Puter.js as an AI provider** (via local proxy bridge translating OpenAI-compatible format to Puter's RPC `/drivers/call` protocol)
2. **Autonomous learning system** that detects shell/tool failures, stores learned corrections, and injects them as system prompt context — all without user interaction.

---

## Part 1: Project Setup & Forking

### Task 1.1: Fork the source code
- Fork `https://github.com/Kilo-Org/kilocode.git`
- Copy only `packages/kilo-vscode/` into the working directory
- Initialize a new git repo with the forked history
- Copy in the SDK dependency (`@kilocode/sdk`) if needed for local builds; otherwise reference as workspace package

### Task 1.2: Set up development environment
- Install dependencies: `bun install` (project uses `bun` as package manager)
- Verify build: `bun run package`
- Verify extension launches in VS Code dev mode
- Update `package.json` fields: `name`, `displayName`, `publisher`, `repository.url`, `version` (e.g. `0.1.0`)

### Task 1.3: Configure build for custom extension
- Update `esbuild.js` if needed to include new source directories
- Verify `launch.json` / dev launch scripts work with the forked extension

---

## Part 2: Puter.js Provider Integration

### Architecture

Puter's API (`POST https://api.puter.com/drivers/call`) uses a custom RPC format, not OpenAI-compatible. Since the Kilo CLI binary (Go) handles all provider API calls and we are forking only the VS Code extension, we add a **local proxy bridge**:

```
Extension starts → Local HTTP proxy (random port) → Registers Puter as OpenAI-compatible provider pointing to localhost:PORT
                                                        ↓
User sends message with Puter model → CLI → OpenAI-format request to localhost:PORT
                                                        ↓
                                              Proxy translates to Puter's RPC format
                                                        ↓
                                              POST https://api.puter.com/drivers/call
                                                        ↓
                                              Response/stream translated back to OpenAI format
                                                        ↓
                                              Returned to CLI → extension → webview
```

### Task 2.1: Create Puter types

**File: `src/puter/puter-types.ts`**

Define TypeScript types for Puter's API:

```typescript
// Puter driver call request
export interface PuterChatRequest {
  interface: "puter-chat-completion"
  driver: "ai-chat"
  method: "complete"
  args: {
    messages: Array<{ role: string; content: string }>
    model?: string
    stream?: boolean
    temperature?: number
    max_tokens?: number
    top_p?: number
    tools?: unknown[]
  }
  auth_token: string
  test_mode?: boolean
}

// Puter driver call response (non-streaming)
export interface PuterChatResponse {
  success: boolean
  result?: {
    message: {
      content: string
      role: string
    }
  }
  error?: { message: string; code?: string }
}

// Puter streaming chunk (ndjson)
export interface PuterStreamChunk {
  text?: string
  done?: boolean
  error?: { message: string; code?: string }
}

// Model listing response
export interface PuterModelDetails {
  id: string
  provider: string
  name: string
  aliases?: string[]
  context?: number
  max_tokens?: number
  cost?: {
    currency: string
    tokens: number
    input: number
    output: number
  }
}
```

### Task 2.2: Create Puter API Client

**File: `src/puter/puter-client.ts`**

Implement HTTP client for Puter:

- `listModels(authToken: string): Promise<PuterModelDetails[]>` — GET `/puterai/chat/models/details`
- `chatCompletion(request: PuterChatRequest): Promise<PuterChatResponse>` — POST `/drivers/call`
- `streamChatCompletion(request: PuterChatRequest): AsyncIterable<PuterStreamChunk>` — POST `/drivers/call` with streaming, parse ndjson
- Handle authentication: `Authorization: Bearer <token>` header
- Handle errors: network failures, invalid tokens, rate limits
- 15-second timeout for model listing; configurable timeout for chat
- Base URL configurable (default `https://api.puter.com`)

### Task 2.3: Create OpenAI-Puter Proxy Server

**File: `src/puter/puter-proxy.ts`**

An HTTP server (Node.js `http` module or `express`-like) that:

- Listens on a random available port (passed via callback)
- Implements the OpenAI `/v1/chat/completions` endpoint (POST):
  - Receives OpenAI-format request: `{ model, messages, stream, temperature, max_tokens, tools }`
  - Reads auth token from `Authorization` header (passed through from CLI)
  - Translates to Puter's RPC format (see types above)
  - For non-streaming: calls Puter API, extracts `result.message.content`, returns OpenAI-style `{ choices: [{ message: { content, role } }] }`
  - For streaming: calls Puter streaming API, translates ndjson chunks to SSE `data: {...}` events with OpenAI delta format
- Implements OpenAI `/v1/models` endpoint (GET):
  - Returns list of models from Puter in OpenAI format: `{ data: [{ id, name, ... }] }`
- Health check endpoint (GET `/health`)
- Graceful shutdown (close on extension deactivate)
- Error handling: return proper HTTP status codes and OpenAI-compatible error bodies

Translation mapping:

| OpenAI Parameter | Puter Parameter |
|---|---|
| `model` | `args.model` |
| `messages` | `args.messages` (passed as-is) |
| `stream` | `args.stream` |
| `temperature` | `args.temperature` |
| `max_tokens` | `args.max_tokens` |
| `tools` | `args.tools` (if supported by Puter) |
| Auth: `Authorization: Bearer X` | `args.auth_token: X` + `Authorization: Bearer X` header |

### Task 2.4: Register Puter Provider in Extension

**File: `src/puter/puter-provider.ts`**

Provider registration module:

- `PROVIDER_ID = "puter"` constant
- `PuterProviderConfig` interface: `{ apiToken: string }`
- `startPuterProxy(): Promise<{ port: number; server: HttpServer }>` — starts the proxy
- `stopPuterProxy(server)` — stops the proxy
- `buildPuterConfig(port, token): CustomProviderConfig` — returns config in the format expected by the custom provider system:
  ```typescript
  {
    npm: "@ai-sdk/openai-compatible",
    name: "Puter.js",
    env: ["PUTER_AUTH_TOKEN"],
    options: {
      baseURL: `http://localhost:${port}`,
      headers: { "Authorization": `Bearer ${token}` }
    },
    models: {} // populated after fetching model list
  }
  ```
- `fetchAndRegisterModels(server, token, providerID)` — fetches models from Puter, registers them with the provider

### Task 2.5: Integrate with Extension Lifecycle

**Modify: `src/extension.ts`**

- On extension activate: if Puter provider is configured (token exists in settings), start proxy server and register Puter provider
- On extension deactivate: stop proxy server
- Handle configuration changes: if Puter token is added/removed, start/stop proxy accordingly

### Task 2.6: Add Puter to Provider Constants

**Modify: `src/shared/provider-model.ts`**

- Add `"puter"` to `PROVIDER_PRIORITY` array (after `"vercel"`)

**Modify or create provider utility to include Puter icon/metadata**

### Task 2.7: Add Puter to VS Code Settings

**Modify: `package.json`** (`contributes.configuration.properties`)

Add settings:
- `kilo-code.new.provider.puter.enabled`: boolean (default false)
- `kilo-code.new.provider.puter.apiToken`: string (for Puter auth token, stored securely via VS Code SecretStorage)
- `kilo-code.new.provider.puter.baseUrl`: string (default `https://api.puter.com`)

### Task 2.8: Add Puter to WebView Provider UI

**Modify files in `webview-ui/src/`:**

- **`src/components/settings/provider-catalog.ts`**: Add Puter to provider catalog with entry `{ id: "puter", name: "Puter.js", icon: "puter" }`
- **`src/components/settings/ProvidersTab.tsx`**: Puter appears in "Popular Providers" section or "View All"
- **`src/components/settings/ProviderConnectDialog.tsx`**: Add Puter-specific connect flow:
  - Single field: "Puter Auth Token" (obtained from Puter.com dashboard)
  - Store token securely
  - On connect, extension starts the proxy and fetches available models
- **`src/context/provider.tsx`**: Ensure Puter provider state is loaded and connected status is tracked

### Task 2.9: Secure Token Storage

**File: `src/puter/puter-secret.ts`**

- Use VS Code's `SecretStorage` API (`context.secrets`) to store Puter auth tokens
- On extension start: retrieve token from secrets, start proxy if token exists
- On connect: store token via secrets API
- On disconnect: delete token from secrets, stop proxy

---

## Part 3: Autonomous Learning System

### Architecture

```
Command/Tool Result → Failure Detector → Pattern Matcher → Lesson Store (JSON)
                                                              ↓
Session Start → System Prompt Builder → Inject relevant lessons → AI session context
```

### Task 3.1: Define Lesson Data Model

**File: `src/learning/lesson-types.ts`**

```typescript
export interface Lesson {
  id: string                    // unique ID (uuid)
  created: number               // timestamp
  updated: number               // last updated timestamp
  frequency: number             // how many times this pattern was observed
  confidence: number            // 0.0 - 1.0 (how confident we are this is correct)
  
  // What went wrong
  observedError: string         // error message pattern (regex-friendly)
  errorContext: string          // what the AI was trying to do
  shellType?: "powershell" | "bash" | "cmd" | "unknown"
  os?: "windows" | "linux" | "macos"
  
  // What should happen instead
  correction: string            // the correct command/approach
  correctionContext: string     // explanation of why
  
  // Status
  source: "auto-detected" | "verified" | "user-confirmed"
  lastApplied: number           // timestamp when last injected
  timesApplied: number          // how many times this was injected
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
```

### Task 3.2: Create Lesson Store

**File: `src/learning/lesson-store.ts`**

Persistent JSON file storage:

- `loadLessons(storagePath: string): Promise<Lesson[]>` — load from JSON file
- `saveLessons(storagePath: string, lessons: Lesson[]): Promise<void>` — save
- `addOrUpdateLesson(lessons: Lesson[], newLesson: Omit<Lesson, 'id' | 'created' | 'updated'>): Lesson[]` — upsert by matching error pattern + context
- `getRelevantLessons(lessons: Lesson[], context: { os?: string; shellType?: string }, maxResults = 10): Lesson[]` — filter by OS/shell, sort by confidence/frequency
- `pruneLowConfidence(lessons: Lesson[], threshold = 0.2): Lesson[]` — remove lessons below confidence
- `getStoragePath(context: vscode.ExtensionContext): string` — resolve to `$HOME/.config/kilo-code-fork/lessons.json` or extension global storage path

**File format**: JSON at `{globalStoragePath}/lessons.json`

### Task 3.3: Create Failure Detector

**File: `src/learning/failure-detector.ts`**

Detect failures from command/tool execution results:

```typescript
export interface ExecutionResult {
  command: string
  exitCode?: number
  stdout: string
  stderr: string
  shellType?: string
  os?: string
  success: boolean        // how the AI classified it (from feedback loop)
}

export interface DetectedFailure {
  command: string
  errorMessage: string    // extracted error message
  shellType?: string
  os?: string
  context: string         // what was being done (e.g., "git commit", "npm install")
  confidence: number       // how sure we are it's a failure
}
```

Detection methods:
1. **Exit code** (fast): Non-zero exit code → failure
2. **Stderr patterns** (fast): Known error keywords (`Error:`, `fatal:`, `'not recognized`, `is not recognized`, `&& was unexpected`, `command not found`, `The term `...` is not recognized`)
3. **AI-based** (hybrid, triggered on unclear cases): For commands that exit 0 but seem wrong (e.g., empty output, known warning patterns), queue for AI analysis. The AI classifies as success/failure in the next response loop.

- `detectFailure(result: ExecutionResult): DetectedFailure | null`
- `needsAIAnalysis(result: ExecutionResult): boolean` — returns true if exit code is 0 but output contains warning patterns
- Known PowerShell-specific patterns: `&&`, `||`, `$(...)` used incorrectly, backtick escaping issues
- Known cross-platform patterns: path separators, environment variable syntax (`$VAR` vs `%VAR%` vs `$env:VAR`)

### Task 3.4: Create Pattern Matcher

**File: `src/learning/pattern-matcher.ts`**

Match failures to corrections and generate lessons:

```typescript
export interface PatternRule {
  id: string
  errorPattern: RegExp
  shellType?: string
  os?: string
  suggestedCorrection: string
  correctionContext: string
}

// Built-in high-priority patterns (seeded knowledge)
export const BUILTIN_PATTERNS: PatternRule[] = [
  {
    id: "powershell-and",
    errorPattern: /&&/,
    shellType: "powershell",
    suggestedCorrection: ";",
    correctionContext: "PowerShell uses semicolon (;) instead of && to chain commands"
  },
  {
    id: "powershell-or",
    errorPattern: /\|\|/,
    shellType: "powershell",
    suggestedCorrection: "; if (-not $?) { ... }",
    correctionContext: "PowerShell uses if (-not $?) instead of || for conditional execution"
  },
  {
    id: "powershell-env-var",
    errorPattern: /\$[A-Z_][A-Z0-9_]*/,
    shellType: "powershell",
    suggestedCorrection: "$env:VARNAME",
    correctionContext: "PowerShell uses $env:VARNAME instead of $VARNAME for environment variables"
  },
  {
    id: "cmd-env-var",
    errorPattern: /\$[A-Z_][A-Z0-9_]*/,
    shellType: "cmd",
    suggestedCorrection: "%VARNAME%",
    correctionContext: "Windows cmd uses %VARNAME% instead of $VARNAME for environment variables"
  },
  {
    id: "unix-path-windows",
    errorPattern: /\/[a-z]+\/[a-z]/,
    os: "windows",
    shellType: "powershell",
    suggestedCorrection: "C:\\path\\to\\file",
    correctionContext: "Windows PowerShell uses backslash paths like C:\\Users\\..."
  },
]

// Learned patterns (from auto-detection)
export const LEARNED_PATTERNS: PatternRule[] = [] // populated from Lesson store
```

Functions:
- `matchBuiltinPattern(failure: DetectedFailure): PatternRule | null`
- `matchLearnedPattern(failure: DetectedFailure, lessons: Lesson[]): Lesson | null`
- `generateLesson(failure: DetectedFailure, correction?: string): Partial<Lesson>`
- `updateConfidence(existing: Lesson, confirmed: boolean): Lesson`

### Task 3.5: Create System Prompt Builder

**File: `src/learning/system-prompt-builder.ts`**

```typescript
export interface LearningContext {
  os: string
  shellType: string
  recentFailures: DetectedFailure[]
  relevantLessons: Lesson[]
}

export function buildLearningPrompt(context: LearningContext): string {
  // Build a structured prompt section with relevant lessons
  // Format as a bullet list of "lessons learned"
  // Only include high-confidence (>= 0.5) and relevant (matched OS/shell) lessons
  // Keep it concise - max ~500 tokens worth of lessons
}
```

Generated prompt format:
```
## Lessons from Previous Sessions

Based on past experience, the following patterns have been identified:

- On Windows PowerShell, do NOT use `&&` to chain commands. Use `;` instead.
- When running `npm install` on Linux, use `sudo npm install` only if permission denied.
- [Lesson 3 from learned data]
- ...

These patterns were learned from {N} previous sessions with {M}% average success rate.
```

### Task 3.6: Create Learning Engine (Orchestrator)

**File: `src/learning/learning-engine.ts`**

Main orchestrator that ties everything together:

```typescript
export class LearningEngine {
  private store: LessonStore
  private detector: FailureDetector
  private matcher: PatternMatcher
  private promptBuilder: SystemPromptBuilder
  private disposables: vscode.Disposable[]
  
  constructor(context: vscode.ExtensionContext)
  
  // Called after each command/tool execution
  async onExecutionResult(result: ExecutionResult): Promise<void>
  
  // Called when session starts, returns prompt additions
  async getLearningPrompt(os: string, shellType: string): Promise<string>
  
  // Called when AI provides feedback on their own action
  async onAIFeedback(feedback: { command: string; success: boolean; notes?: string }): Promise<void>
  
  // Periodic maintenance
  async runMaintenance(): Promise<void>  // prune low-confidence, recalculate stats
}
```

### Task 3.7: Hook into Command Execution

**Modify: `src/kilo-provider/` or relevant session management files**

The learning system needs to intercept command execution results. This requires identifying where shell commands are executed and their results are returned.

Key integration points:
- **After each tool use** (especially `bash`/`shell` commands), the execution result (exit code, stdout, stderr) is available
- **The SSE event stream** contains execution results
- **`mapSSEEventToWebviewMessage`** in `kilo-provider-utils.ts` is a good hook point for capturing results
- Alternatively, intercept at the CLI communication layer

Implementation:
- After each shell execution SSE event, pass the result to `LearningEngine.onExecutionResult()`
- The engine processes: detect failure → match pattern → store/update lesson

### Task 3.8: Inject Learning Prompt into Session

**Modify: System prompt construction in the extension**

- On new session creation, call `LearningEngine.getLearningPrompt(os, shellType)`
- Append the returned prompt text to the system message
- This makes the AI aware of past mistakes at the very start of each session

### Task 3.9: Cross-Session Persistence

- Lessons are stored in a JSON file in the extension's global storage path
- On extension activate: load lessons from file
- On lesson update: save to file (debounced, max once per 5 seconds)
- File location: `{globalStoragePath}/learned-lessons.json`

### Task 3.10: Maintenance & Cleanup

- Run cleanup on extension start (every 24 hours):
  - Remove lessons with confidence < 0.2 that have been applied < 3 times
  - Merge duplicate lessons (same error pattern + context)
  - Recalculate confidence scores based on frequency
- Max 500 lessons stored (oldest/lowest confidence pruned first)

---

## Part 4: Testing & Validation

### Task 4.1: Unit Tests for Puter Provider

- `tests/unit/puter/puter-client.test.ts` — mock HTTP responses, test model listing and chat completion
- `tests/unit/puter/puter-proxy.test.ts` — test translation of OpenAI→Puter and Puter→OpenAI formats
- `tests/unit/puter/puter-secret.test.ts` — test secret storage integration

### Task 4.2: Unit Tests for Learning System

- `tests/unit/learning/lesson-store.test.ts` — CRUD operations, filtering, pruning
- `tests/unit/learning/failure-detector.test.ts` — test all detection methods
- `tests/unit/learning/pattern-matcher.test.ts` — test built-in and learned patterns
- `tests/unit/learning/system-prompt-builder.test.ts` — test prompt generation
- `tests/unit/learning/learning-engine.test.ts` — integration test of full pipeline

### Task 4.3: Manual Testing Checklist

- [ ] Puter provider appears in provider list
- [ ] Connect Puter with valid auth token stores securely
- [ ] Disconnect removes token
- [ ] Chat with Puter model works (non-streaming)
- [ ] Chat with Puter model works (streaming)
- [ ] Model list is fetched and populated correctly
- [ ] Proxy starts/stops with extension lifecycle
- [ ] Learning file is created after command failures
- [ ] Lessons persist across extension restarts
- [ ] System prompt includes relevant lessons
- [ ] PowerShell `&&` → `;` correction works end-to-end

---

## Files to Create

| File | Purpose |
|---|---|
| `src/puter/puter-types.ts` | Puter API type definitions |
| `src/puter/puter-client.ts` | Puter HTTP API client |
| `src/puter/puter-proxy.ts` | OpenAI→Puter translation proxy |
| `src/puter/puter-provider.ts` | Provider registration & lifecycle |
| `src/puter/puter-secret.ts` | Secure token storage |
| `src/learning/lesson-types.ts` | Data model for lessons |
| `src/learning/lesson-store.ts` | JSON file persistence |
| `src/learning/failure-detector.ts` | Failure detection logic |
| `src/learning/pattern-matcher.ts` | Error pattern matching |
| `src/learning/system-prompt-builder.ts` | Learning prompt generation |
| `src/learning/learning-engine.ts` | Main orchestrator |

## Files to Modify

| File | Changes |
|---|---|
| `src/extension.ts` | Start/stop Puter proxy, init learning engine |
| `src/shared/provider-model.ts` | Add `"puter"` to PROVIDER_PRIORITY |
| `package.json` | Add Puter settings, update metadata |
| `webview-ui/src/components/settings/provider-catalog.ts` | Add Puter entry |
| `webview-ui/src/components/settings/ProvidersTab.tsx` | Add Puter UI |
| `webview-ui/src/components/settings/ProviderConnectDialog.tsx` | Add Puter connect flow |
| `webview-ui/src/context/provider.tsx` | Track Puter connection state |
| `src/kilo-provider-utils.ts` or session handlers | Hook command execution for learning |

## Key Design Decisions

1. **Proxy bridge over native implementation**: The Puter proxy allows reuse of the existing `@ai-sdk/openai-compatible` provider pipeline. The extension starts a lightweight HTTP server that translates OpenAI↔Puter formats transparently.

2. **Hybrid failure detection**: Exit codes + stderr patterns cover 90% of cases cheaply. AI-based analysis on remaining ambiguous cases adds accuracy where needed.

3. **Dual storage + prompt injection**: Storing lessons permanently in JSON ensures cross-session persistence. Injecting relevant lessons into the system prompt ensures the AI sees them without needing to query an external database during chat.

4. **Confidence scoring**: Lessons start at 0.5 confidence. Each time a lesson matches and the subsequent attempt succeeds, confidence increases. If the same error repeats despite the lesson, confidence decreases. This prevents noise from polluting the prompt.
