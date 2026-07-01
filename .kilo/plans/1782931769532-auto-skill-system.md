# Auto-Skill System — Implementation Plan

## Goal

Auto-download, install, and inject skill content into the LLM context based on the user's prompt, without requiring the LLM to call the `skill` tool. Hybrid matching (keywords + AI via Puter.js). Built-in default registry + configurable URLs.

---

## How It Works

```
User types prompt
       │
       ▼
AutoSkillEngine.match(prompt) ───► Skill Registry Client ───► index.json (cached)
       │                                                            │
       │                                                            ▼
       │                                                     Skill Registry (GitHub URL)
       │
       ▼
  Keyword matcher (fast): prompt words vs skill.name/tags/keywords
       │
       ▼ score < threshold?
       │
       ├── YES ──► AI matcher (Puter.js): confirm relevance
       │                │
       │                ▼
       │           confirm? ──NO──► skip
       │                │
       │                ▼ YES
       ├── NO ──► skip (already installed or low score)
       │
       ▼
  Download SKILL.md from registry → .kilo/skills/<name>/
       │
       ▼
  Inject as TextPartInput[0] in promptAsync({ parts })
       │
       ▼
  CLI sends to LLM: [skill content] + [user message]
```

---

## Files to Create

### `src/skill-registry/registry-types.ts`
Types for the skill registry index and matching results.

```typescript
interface SkillRegistryIndex {
  version: number
  registries: SkillRegistryEntry[]
}

interface SkillRegistryEntry {
  url: string           // base URL for this registry
  skills: RegistrySkill[]
}

interface RegistrySkill {
  name: string
  description: string
  tags: string[]
  keywords: string[]
  skillPath: string     // relative path to SKILL.md within registry
}

interface MatchResult {
  skill: RegistrySkill
  registry: SkillRegistryEntry
  score: number         // 0.0 - 1.0
  matchMethod: "keyword" | "ai"
}
```

### `src/skill-registry/registry-client.ts`
Fetches and caches registry indexes.

- `fetchIndex(url: string): Promise<SkillRegistryIndex>` — fetches `index.json` from URL
- `fetchSkillContent(registry: SkillRegistryEntry, skill: RegistrySkill): Promise<string>` — fetches the `SKILL.md` content
- `loadAllRegistries(urls: string[]): Promise<Map<string, SkillRegistryEntry>>` — loads all configured registries
- Caches index in `ExtensionContext.globalState` for 1 hour

### `src/skill-registry/skill-matcher.ts`
Hybrid keyword + AI matching engine.

- `keywordScore(prompt: string, skill: RegistrySkill): number` — fast keyword match
  - Tokenizes prompt into lowercase words
  - Matches against skill name (exact=0.9, partial=0.6), tags (each=0.4), keywords (each=0.5), description (per word=0.2)
  - Returns `matchCount / maxExpected` normalized to 0-1
- `aiConfirm(prompt: string, skill: RegistrySkill, puterClient: PuterClient): Promise<boolean>` — AI verification
  - Sends a simple prompt to Puter: "Does this user request match this skill? skill: <name>, description: <desc>, user: <prompt>"
  - Returns true/false based on response
- `match(prompt: string, skills: RegistrySkill[]): Promise<MatchResult[]>`
  - Runs keyword matcher on all skills
  - Finds top candidates above threshold (default 0.3)
  - For candidates between 0.3-0.7, runs AI confirm
  - Returns sorted match results with scores

### `src/skill-registry/auto-skill-engine.ts`
Orchestrator that ties everything together.

```
class AutoSkillEngine {
  registries: Map<string, SkillRegistryEntry>
  installedSkills: Set<string>      // tracked in globalState
  puterClient?: PuterClient         // optional, for AI matching

  async initialize(context: ExtensionContext): Promise<void>
    - Load registry indexes from all configured URLs
    - Restore installedSkills set from globalState
    - (Optional) Restore PuterClient from puter module

  async onUserMessage(prompt: string): Promise<string | null>
    - Skip if autoDownload setting is false
    - Run matching
    - For new matches above threshold:
      a. Download SKILL.md content
      b. Write to .kilo/skills/<name>/SKILL.md
      c. Record in installedSkills
      d. Aggregate content into "skillBlock"
    - Return skillBlock (null if nothing matched)

  dispose(): Promise<void>
    - Save installedSkills to globalState
}
```

### `src/skill-registry/index.ts`
Re-exports from all skill-registry modules.

### `src/skill-registry/README.md`
Documentation for skill registry maintainers.

---

## Files to Modify

### `src/extension.ts`
- Import and initialize `AutoSkillEngine` during activation
- Call `autoSkillEngine.dispose()` during deactivation

### `src/KiloProvider.ts`
- In `handleSendMessage()` (around line 3030), BEFORE calling `this.client!.session.promptAsync(...)`:
  1. Get the user message text from `message.text`
  2. Call `this.autoSkillEngine.onUserMessage(text)`
  3. If skill block returned, prepend it to the `parts` array:
     ```ts
     const skillBlock = await this.autoSkillEngine.onUserMessage(text)
     const skillParts: TextPartInput[] = skillBlock
       ? [{ type: "text", text: skillBlock }]
       : []
     const allParts = [...skillParts, ...parts]
     ```
  4. Pass `allParts` instead of `parts` to `promptAsync()`

### `package.json`
Add to `contributes.configuration.properties`:

```json
"kilo-code.new.skills.autoDownload": {
  "type": "boolean",
  "default": true,
  "description": "Auto-download skills from registries based on your prompts"
},
"kilo-code.new.skills.registries": {
  "type": "array",
  "default": [
    "https://raw.githubusercontent.com/jahdaganj03ki-wq/kilo-skills/main/index.json"
  ],
  "description": "Skill registry URLs to fetch skill indexes from",
  "items": { "type": "string", "format": "uri" }
},
"kilo-code.new.skills.autoLoadThreshold": {
  "type": "number",
  "default": 0.3,
  "minimum": 0.0,
  "maximum": 1.0,
  "description": "Minimum keyword match score (0-1) to trigger skill loading"
},
"kilo-code.new.skills.aiThreshold": {
  "type": "number",
  "default": 0.7,
  "minimum": 0.0,
  "maximum": 1.0,
  "description": "Scores below this threshold trigger AI confirmation (requires Puter.js enabled)"
},
"kilo-code.new.skills.maxSkillsPerMessage": {
  "type": "integer",
  "default": 2,
  "minimum": 1,
  "maximum": 5,
  "description": "Maximum number of skills to auto-load per message"
}
```

---

## Skill Registry Format

### Default registry repo: `jahdaganj03ki-wq/kilo-skills`

```
kilo-skills/
├── index.json
└── skills/
    ├── react-testing/
    │   ├── SKILL.md
    │   └── (optional resource files)
    ├── python-django/
    │   └── SKILL.md
    └── git-workflow/
        └── SKILL.md
```

### `index.json` format:

```json
{
  "version": 1,
  "skills": [
    {
      "name": "react-testing",
      "description": "Expert guidance on testing React components with @testing-library/react, Vitest, and Playwright.",
      "tags": ["react", "testing", "vitest", "jest", "frontend"],
      "keywords": [
        "react component test",
        "unit test react",
        "testing library",
        "test react hook",
        "integration test react"
      ],
      "skillPath": "skills/react-testing/SKILL.md"
    }
  ]
}
```

### `SKILL.md` format (standard Kilo skill file):

```markdown
---
name: react-testing
description: Expert guidance on testing React components
---

# React Testing Skill

When working with React component tests...

- Use `@testing-library/react` for component tests
- Prefer `screen.getByRole()` over `container.querySelector()`
- ...
```

---

## Matching Algorithm Detail

### Keyword Score Calculation

```
Input: prompt = "how do I test my react component with jest"
       skill.tags = ["react", "testing", "vitest"]
       skill.keywords = ["react component test", "unit test react"]
       skill.name = "react-testing"

Steps:
1. Tokenize prompt: [how, do, i, test, my, react, component, with, jest]
2. Match name: "react-testing" → "react" found, "testing" found
   → 2/2 exact subword match → 0.9
3. Match tags: "react" → found, "testing" → found, "vitest" → not found
   → 2/3 matches → 0.66 * 0.4 = 0.26
4. Match keywords: "react component test" → 3/4 words → 0.75 * 0.5 = 0.38
   "unit test react" → 0/3 → 0
5. Description match: fuzzy word overlap
6. Final score = max(0.9, 0.26, 0.38, ...) = 0.9
```

### AI Confirmation (for scores 0.3 - 0.7)

When `autoLoadThreshold ≤ keywordScore < aiThreshold`, send to Puter.js:

```json
{
  "model": "puter-gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "You determine if a user's request matches a skill. Reply only 'YES' or 'NO'."
    },
    {
      "role": "user",
      "content": "Skill: react-testing — Expert guidance on testing React components...\nUser request: how do I test my react component with jest\n\nDoes this match?"
    }
  ]
}
```

If AI responds 'YES' and keywordScore ≥ autoLoadThreshold, the skill is loaded.

---

## Injection Format

The skill content is injected as the first `TextPartInput` in the `parts` array:

```ts
parts = [
  { type: "text", text: "<auto-skill name=\"react-testing\">\n...skill content...\n</auto-skill>" },
  { type: "text", text: "how do I test my react component with jest" },
]
```

The LLM receives both parts sequentially and sees the skill as instruction context.

---

## Testing

1. **Unit tests** for `SkillMatcher.keywordScore()` — test scoring with various prompts
2. **Unit tests** for `RegistryClient.fetchIndex()` — mock HTTP, test cache hit/miss
3. **Unit tests** for `AutoSkillEngine.onUserMessage()` — mock matcher + downloader
4. **Integration** — Manually verify:
   - Skills appear in `.kilo/skills/<name>/` after matching
   - Skill content appears in the LLM context (visible in responses)
   - No re-download of already-installed skills
   - Disabled `autoDownload` setting skips all matching

---

## Edge Cases / Failure Modes

| Scenario | Handling |
|---|---|
| Registry URL unreachable | Gracefully skip, log warning, retry on next message |
| Skill download fails | Skip that skill, log error, mark as failed to avoid retry spam |
| No Puter.js client available | AI confirm skipped, use keyword score only |
| Skill already installed (same name) | Skip download, content is already in `.kilo/skills/` |
| Score exactly at threshold | `>=` threshold → include; `<` threshold → skip |
| Prompt very short (1-2 words) | Low confidence; likely below threshold unless exact name match |
| `maxSkillsPerMessage` exceeded | Take top N by score, log skipped ones |
| `.kilo/skills/` directory doesn't exist | Create it during download |
| Duplicate skill names across registries | First registry wins (order of `registries[]` config) |
