export interface RegistrySkill {
  name: string
  description: string
  tags: string[]
  keywords: string[]
  skillPath: string
}

export interface SkillRegistryEntry {
  url: string
  skills: RegistrySkill[]
}

export interface SkillRegistryIndex {
  version: number
  registries: SkillRegistryEntry[]
}

export interface MatchResult {
  skill: RegistrySkill
  registry: SkillRegistryEntry
  score: number
  matchMethod: "keyword" | "ai"
}

export interface AutoSkillSettings {
  autoDownload: boolean
  registries: string[]
  autoLoadThreshold: number
  aiThreshold: number
  maxSkillsPerMessage: number
}
