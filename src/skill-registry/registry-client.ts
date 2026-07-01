import type { SkillRegistryIndex, SkillRegistryEntry, RegistrySkill } from "./registry-types"

const INDEX_CACHE_TTL_MS = 3_600_000

class RegistryFetchError extends Error {
  constructor(url: string, reason: string) {
    super(`Failed to fetch registry index from ${url}: ${reason}`)
    this.name = "RegistryFetchError"
  }
}

interface CacheEntry {
  registry: SkillRegistryEntry
  fetchedAt: number
}

export class RegistryClient {
  private cache = new Map<string, CacheEntry>()
  private pending = new Map<string, Promise<CacheEntry>>()

  async fetchIndex(url: string): Promise<SkillRegistryEntry> {
    const existing = this.cache.get(url)
    if (existing && Date.now() - existing.fetchedAt < INDEX_CACHE_TTL_MS) {
      return existing.registry
    }
    const pending = this.pending.get(url)
    if (pending) return (await pending).registry

    const promise = this.doFetch(url)
    this.pending.set(url, promise)
    try {
      return (await promise).registry
    } finally {
      this.pending.delete(url)
    }
  }

  private async doFetch(url: string): Promise<CacheEntry> {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      throw new RegistryFetchError(url, `HTTP ${res.status}`)
    }
    const text = await res.text()
    let parsed: SkillRegistryIndex
    try {
      parsed = JSON.parse(text) as SkillRegistryIndex
    } catch {
      throw new RegistryFetchError(url, "invalid JSON")
    }
    if (!parsed.version || !Array.isArray(parsed.registries)) {
      throw new RegistryFetchError(url, "missing version or registries array")
    }
    const entry: SkillRegistryEntry = {
      url,
      skills: parsed.registries.flatMap((r) => r.skills ?? []),
    }
    const cached: CacheEntry = { registry: entry, fetchedAt: Date.now() }
    this.cache.set(url, cached)
    return cached
  }

  async fetchSkillContent(registry: SkillRegistryEntry, skill: RegistrySkill): Promise<string> {
    const baseUrl = registry.url.replace(/\/[^/]*$/, "")
    const skillUrl = `${baseUrl}/${skill.skillPath}`
    const res = await fetch(skillUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      throw new RegistryFetchError(skillUrl, `HTTP ${res.status}`)
    }
    return res.text()
  }

  async loadAllRegistries(urls: string[]): Promise<Map<string, SkillRegistryEntry>> {
    const map = new Map<string, SkillRegistryEntry>()
    const results = await Promise.allSettled(urls.map((url) => this.fetchIndex(url)))
    for (const result of results) {
      if (result.status === "fulfilled") {
        map.set(result.value.url, result.value)
      }
    }
    return map
  }

  invalidateCache(url?: string): void {
    if (url) {
      this.cache.delete(url)
    } else {
      this.cache.clear()
    }
  }
}
