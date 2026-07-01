import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import type { RegistrySkill, SkillRegistryEntry, MatchResult, AutoSkillSettings } from "./registry-types"
import { RegistryClient } from "./registry-client"
import { match, keywordScore, buildAiMatcher } from "./skill-matcher"

const INSTALLED_SKILLS_KEY = "skill-registry.installed"
const FAILED_SKILLS_KEY = "skill-registry.failed"

const DEFAULT_REGISTRIES = [
  "https://raw.githubusercontent.com/jahdaganj03ki-wq/kilo-skills/main/index.json",
]

const DEFAULT_SETTINGS: AutoSkillSettings = {
  autoDownload: true,
  registries: DEFAULT_REGISTRIES,
  autoLoadThreshold: 0.3,
  aiThreshold: 0.7,
  maxSkillsPerMessage: 2,
}

function readSettings(): AutoSkillSettings {
  const config = vscode.workspace.getConfiguration("kilo-code.new.skills")
  return {
    autoDownload: config.get<boolean>("autoDownload", DEFAULT_SETTINGS.autoDownload),
    registries: config.get<string[]>("registries", DEFAULT_SETTINGS.registries),
    autoLoadThreshold: config.get<number>("autoLoadThreshold", DEFAULT_SETTINGS.autoLoadThreshold),
    aiThreshold: config.get<number>("aiThreshold", DEFAULT_SETTINGS.aiThreshold),
    maxSkillsPerMessage: config.get<number>("maxSkillsPerMessage", DEFAULT_SETTINGS.maxSkillsPerMessage),
  }
}

function skillDir(context: vscode.ExtensionContext): string {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) return ""
  return path.join(workspaceFolders[0].uri.fsPath, ".kilo", "skills")
}

export class AutoSkillEngine {
  private client = new RegistryClient()
  private registries = new Map<string, SkillRegistryEntry>()
  private installedSkills = new Set<string>()
  private failedSkills = new Set<string>()
  private context: vscode.ExtensionContext
  private ready = false

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  async initialize(): Promise<void> {
    try {
      this.installedSkills = new Set(
        this.context.globalState.get<string[]>(INSTALLED_SKILLS_KEY, []),
      )
      this.failedSkills = new Set(
        this.context.globalState.get<string[]>(FAILED_SKILLS_KEY, []),
      )

      const settings = readSettings()
      const urls = settings.registries.length > 0 ? settings.registries : DEFAULT_REGISTRIES
      this.registries = await this.client.loadAllRegistries(urls)
      this.ready = true
    } catch (err) {
      console.warn("[AutoSkillEngine] initialization error:", err)
    }
  }

  async onUserMessage(prompt: string): Promise<string | null> {
    if (!this.ready) return null

    const settings = readSettings()
    if (!settings.autoDownload) return null

    const allSkills: Array<{ skill: RegistrySkill; registry: SkillRegistryEntry }> = []
    for (const entry of this.registries.values()) {
      for (const skill of entry.skills) {
        allSkills.push({ skill, registry: entry })
      }
    }

    if (allSkills.length === 0) return null

    const puterToken = this.getPuterToken()
    const aiMatcher = puterToken ? buildAiMatcher(puterToken, "https://api.puter.com") : undefined

    const scored = allSkills
      .map(({ skill }) => ({ skill, score: keywordScore(prompt, skill) }))
      .filter(({ score }) => score >= settings.autoLoadThreshold)
      .sort((a, b) => b.score - a.score)

    const topCandidates = scored.slice(0, settings.maxSkillsPerMessage * 2)
    const results: MatchResult[] = []

    for (const { skill, score } of topCandidates) {
      if (results.length >= settings.maxSkillsPerMessage) break

      if (skill.name.includes(":")) continue

      if (this.installedSkills.has(skill.name)) {
        results.push({ skill, registry: null!, score, matchMethod: "keyword" })
        continue
      }

      if (this.failedSkills.has(skill.name)) continue

      if (score >= settings.aiThreshold) {
        await this.downloadSkill(skill)
        results.push({ skill, registry: null!, score, matchMethod: "keyword" })
        continue
      }

      if (aiMatcher && score >= settings.autoLoadThreshold) {
        try {
          const confirmed = await aiMatcher(prompt, skill)
          if (confirmed) {
            await this.downloadSkill(skill)
            results.push({ skill, registry: null!, score, matchMethod: "ai" })
          }
        } catch {
          // ai matcher failed, skip
        }
      }
    }

    if (results.length === 0) return null

    const blocks = results.map(
      (r) => `<auto-skill name="${r.skill.name}">\n${r.skill.description}\n</auto-skill>`,
    )

    return blocks.join("\n")
  }

  private async downloadSkill(skill: RegistrySkill): Promise<void> {
    const dir = skillDir(this.context)
    if (!dir) {
      this.installedSkills.add(skill.name)
      return
    }

    const targetPath = path.join(dir, skill.name, "SKILL.md")
    try {
      const exists = fs.existsSync(targetPath)
      if (exists) {
        this.installedSkills.add(skill.name)
        return
      }

      const url = `https://raw.githubusercontent.com/jahdaganj03ki-wq/kilo-skills/main/${skill.skillPath}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) {
        this.failedSkills.add(skill.name)
        return
      }
      const content = await res.text()

      const skillDirPath = path.dirname(targetPath)
      fs.mkdirSync(skillDirPath, { recursive: true })
      fs.writeFileSync(targetPath, content, "utf-8")

      this.installedSkills.add(skill.name)
    } catch {
      this.failedSkills.add(skill.name)
    } finally {
      this.persistState()
    }
  }

  private getPuterToken(): string | undefined {
    try {
      const config = vscode.workspace.getConfiguration("kilo-code.new.provider.puter")
      const token = config.get<string>("apiToken", "")
      return token || undefined
    } catch {
      return undefined
    }
  }

  private persistState(): void {
    void this.context.globalState.update(INSTALLED_SKILLS_KEY, [...this.installedSkills])
    void this.context.globalState.update(FAILED_SKILLS_KEY, [...this.failedSkills])
  }

  async dispose(): Promise<void> {
    this.persistState()
    this.client.invalidateCache()
    this.ready = false
  }
}
