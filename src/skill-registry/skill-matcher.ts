import type { RegistrySkill, MatchResult, SkillRegistryEntry } from "./registry-types"

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "about", "up", "what",
  "which", "who", "whom", "this", "that", "these", "those", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "them", "their", "his", "her", "its", "please", "need", "want", "help",
])

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()
  return normalized.split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

function countWordOverlap(words: string[], phrase: string): number {
  const phraseWords = tokenize(phrase)
  if (phraseWords.length === 0) return 0
  const matched = phraseWords.filter((pw) => words.includes(pw)).length
  return matched / phraseWords.length
}

export function keywordScore(prompt: string, skill: RegistrySkill): number {
  const words = tokenize(prompt)
  if (words.length === 0) return 0

  const scores: number[] = []

  const nameWords = tokenize(skill.name)
  const nameHits = nameWords.filter((nw) => words.includes(nw)).length
  if (nameWords.length > 0) {
    const nameRatio = nameHits / nameWords.length
    if (nameRatio >= 1) scores.push(0.9)
    else if (nameRatio >= 0.5) scores.push(0.6)
    else if (nameHits > 0) scores.push(0.3)
  }

  for (const tag of skill.tags) {
    const tagHits = countWordOverlap(words, tag)
    if (tagHits >= 0.5) scores.push(0.4)
  }

  for (const kw of skill.keywords) {
    const kwHits = countWordOverlap(words, kw)
    if (kwHits > 0) scores.push(kwHits * 0.5)
  }

  const descWords = tokenize(skill.description)
  const descHits = descWords.filter((dw) => words.includes(dw)).length
  if (descWords.length > 0) {
    const descRatio = descHits / descWords.length
    if (descRatio > 0) scores.push(descRatio * 0.2)
  }

  if (scores.length === 0) return 0
  return Math.min(Math.max(...scores), 1.0)
}

export interface AiMatcher {
  (prompt: string, skill: RegistrySkill): Promise<boolean>
}

export async function match(
  prompt: string,
  skills: RegistrySkill[],
  autoLoadThreshold: number,
  aiThreshold: number,
  maxResults: number,
  aiMatcher?: AiMatcher,
): Promise<MatchResult[]> {
  const scored: Array<{ skill: RegistrySkill; score: number }> = []

  for (const skill of skills) {
    const score = keywordScore(prompt, skill)
    if (score >= autoLoadThreshold) {
      scored.push({ skill, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const topCandidates = scored.slice(0, maxResults * 2)
  const results: MatchResult[] = []

  for (const { skill, score } of topCandidates) {
    if (results.length >= maxResults) break

    if (score >= aiThreshold) {
      results.push({ skill, registry: null!, score, matchMethod: "keyword" })
      continue
    }

    if (aiMatcher && score >= autoLoadThreshold) {
      const confirmed = await aiMatcher(prompt, skill)
      if (confirmed) {
        results.push({ skill, registry: null!, score, matchMethod: "ai" })
      }
    }
  }

  return results
}

export function buildAiMatcher(apiToken: string, baseUrl: string): AiMatcher {
  return async (prompt: string, skill: RegistrySkill): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/drivers/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          interface: "puter-chat-completion",
          driver: "ai-chat",
          method: "complete",
          args: {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You determine if a user's request matches a skill's description. Reply only with a single word: YES or NO.",
              },
              {
                role: "user",
                content: `Skill: ${skill.name} — ${skill.description}\nTags: ${skill.tags.join(", ")}\nUser request: ${prompt}\n\nDoes this match?`,
              },
            ],
            max_tokens: 10,
            temperature: 0,
          },
          auth_token: apiToken,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return false
      const body = await res.json() as { result?: { message?: { content?: string } } }
      const reply = body?.result?.message?.content?.trim().toUpperCase() ?? ""
      return reply === "YES"
    } catch {
      return false
    }
  }
}
