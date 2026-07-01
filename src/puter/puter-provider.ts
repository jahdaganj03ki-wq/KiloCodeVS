import * as vscode from "vscode"
import { createPuterProxy, type ProxyConfig, type ProxyHandle } from "./puter-proxy"
import { listModels } from "./puter-client"
import { PUTER_PROVIDER_ID, PUTER_BASE_URL } from "./puter-types"
import type { SanitizedProviderConfig } from "../shared/custom-provider"

const PUTER_TOKEN_SECRET_KEY = "puter.auth.token"

export function getPuterSettings(): { enabled: boolean; apiToken: string; baseUrl: string } {
  const config = vscode.workspace.getConfiguration("kilo-code.new.provider.puter")
  return {
    enabled: config.get<boolean>("enabled", false),
    apiToken: config.get<string>("apiToken", ""),
    baseUrl: config.get<string>("baseUrl", PUTER_BASE_URL),
  }
}

export async function getStoredToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(PUTER_TOKEN_SECRET_KEY)
}

export async function storeToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store(PUTER_TOKEN_SECRET_KEY, token)
}

export async function deleteToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(PUTER_TOKEN_SECRET_KEY)
}

export function buildPuterCustomProviderConfig(
  port: number,
  baseURL: string,
  token: string,
): SanitizedProviderConfig {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Puter.js",
    env: ["PUTER_AUTH_TOKEN"],
    options: {
      baseURL: `http://127.0.0.1:${port}`,
      headers: { Authorization: `Bearer ${token}` },
    },
    models: {},
  }
}

export async function fetchPuterModels(token: string, baseURL: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const models = await listModels(token, baseURL)
    return models.map((m) => ({ id: m.id, name: m.name || m.id }))
  } catch (err) {
    console.error("[Puter] Failed to fetch models:", err)
    return []
  }
}

export async function startPuterProxy(context: vscode.ExtensionContext): Promise<ProxyHandle | null> {
  const settings = getPuterSettings()
  if (!settings.enabled) return null

  const token = settings.apiToken || (await getStoredToken(context))
  if (!token) return null

  try {
    const handle = await createPuterProxy({
      authToken: token,
      baseURL: settings.baseUrl,
    })
    console.log(`[Puter] Proxy started on port ${handle.port}`)
    return handle
  } catch (err) {
    console.error("[Puter] Failed to start proxy:", err)
    return null
  }
}

export function stopPuterProxy(handle: ProxyHandle | null): void {
  if (!handle) return
  try {
    handle.server.close()
    console.log("[Puter] Proxy stopped")
  } catch (err) {
    console.error("[Puter] Error stopping proxy:", err)
  }
}

export async function registerPuterModels(
  handle: ProxyHandle,
  token: string,
  baseURL: string,
): Promise<SanitizedProviderConfig> {
  const models = await fetchPuterModels(token, baseURL)
  const config = buildPuterCustomProviderConfig(handle.port, baseURL, token)
  config.models = {}
  for (const m of models) {
    config.models[m.id] = { name: m.name }
  }
  return config
}
