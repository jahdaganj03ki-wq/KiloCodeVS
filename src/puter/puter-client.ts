import { PUTER_BASE_URL } from "./puter-types"
import type {
  PuterChatRequest,
  PuterChatResponse,
  PuterStreamChunk,
  PuterModelDetails,
} from "./puter-types"

export class PuterClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = "PuterClientError"
  }
}

async function puterFetch(
  path: string,
  authToken: string,
  options: RequestInit = {},
  baseURL = PUTER_BASE_URL,
): Promise<Response> {
  const url = `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
    ...(options.headers as Record<string, string> | undefined),
  }
  const res = await fetch(url, { ...options, headers })
  return res
}

export async function listModels(authToken: string, baseURL = PUTER_BASE_URL): Promise<PuterModelDetails[]> {
  const res = await puterFetch("puterai/chat/models/details", authToken, {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  }, baseURL)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new PuterClientError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  const body = await res.json() as { data?: PuterModelDetails[] } | PuterModelDetails[]
  if (Array.isArray(body)) return body
  if (body?.data && Array.isArray(body.data)) return body.data
  return []
}

export async function chatCompletion(
  request: PuterChatRequest,
  baseURL = PUTER_BASE_URL,
): Promise<PuterChatResponse> {
  const res = await puterFetch("drivers/call", request.auth_token, {
    method: "POST",
    body: JSON.stringify(request),
  }, baseURL)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new PuterClientError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  const body = await res.json() as PuterChatResponse
  return body
}

export async function* streamChatCompletion(
  request: PuterChatRequest,
  baseURL = PUTER_BASE_URL,
): AsyncGenerator<PuterStreamChunk> {
  const res = await puterFetch("drivers/call", request.auth_token, {
    method: "POST",
    body: JSON.stringify(request),
  }, baseURL)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new PuterClientError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new PuterClientError("No response body stream available")
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const chunk = JSON.parse(trimmed) as PuterStreamChunk
        yield chunk
      } catch {
        // skip unparseable lines
      }
    }
  }
  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer.trim()) as PuterStreamChunk
      yield chunk
    } catch {
      // skip
    }
  }
}
