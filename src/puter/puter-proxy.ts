import * as http from "http"
import { chatCompletion, streamChatCompletion, listModels } from "./puter-client"
import type {
  OpenAICompatibleModel,
  OpenAICompletion,
  OpenAIChunk,
  OpenAIError,
  PuterChatRequest,
  PuterModelDetails,
} from "./puter-types"
import { PUTER_PROVIDER_ID } from "./puter-types"

export interface ProxyConfig {
  authToken: string
  baseURL?: string
  port?: number
}

export interface ProxyHandle {
  port: number
  server: http.Server
}

let requestIdCounter = 0
function nextId() {
  return `chatcmpl-${Date.now()}-${++requestIdCounter}`
}

function translatePuterModelsToOpenAI(models: PuterModelDetails[]): OpenAICompatibleModel[] {
  const seen = new Set<string>()
  const result: OpenAICompatibleModel[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const m of models) {
    const id = m.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      name: m.name || id,
      object: "model",
      created: now,
      owned_by: m.provider || "puter",
    })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

function bodyParser(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error("Invalid JSON"))
      }
    })
    req.on("error", reject)
  })
}

function writeError(res: http.ServerResponse, status: number, message: string, type = "api_error") {
  const body: OpenAIError = { error: { message, type, param: null, code: null } }
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function readAuthToken(req: http.IncomingMessage): string | null {
  const auth = req.headers["authorization"]
  if (!auth || Array.isArray(auth)) return null
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

export function createPuterProxy(config: ProxyConfig): Promise<ProxyHandle> {
  return new Promise((resolve, reject) => {
    const { authToken, baseURL, port: desiredPort } = config
    if (!authToken) {
      reject(new Error("Puter auth token is required"))
      return
    }

    const server = http.createServer(async (req, res) => {
      const method = req.method?.toUpperCase()
      const url = req.url ?? ""

      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

      if (method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
      }

      try {
        if (method === "GET" && url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ status: "ok", provider: PUTER_PROVIDER_ID }))
          return
        }

        if (method === "GET" && url === "/v1/models") {
          const models = await listModels(authToken, baseURL)
          const translated = translatePuterModelsToOpenAI(models)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ object: "list", data: translated }))
          return
        }

        if (method === "POST" && url === "/v1/chat/completions") {
          const body = await bodyParser(req) as Record<string, unknown> | null
          if (!body) {
            writeError(res, 400, "Request body is required")
            return
          }

          const token = readAuthToken(req)
          if (!token) {
            writeError(res, 401, "Authorization header with Bearer token is required")
            return
          }

          const stream = body.stream === true
          const puterRequest: PuterChatRequest = {
            interface: "puter-chat-completion",
            driver: "ai-chat",
            method: "complete",
            args: {
              messages: body.messages as Array<{ role: string; content: string }> || [],
              model: body.model as string | undefined,
              stream,
              temperature: body.temperature as number | undefined,
              max_tokens: body.max_tokens as number | undefined,
            },
            auth_token: token,
          }

          if (stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            })
            const id = nextId()
            let index = 0
            try {
              for await (const chunk of streamChatCompletion(puterRequest, baseURL)) {
                if (chunk.error) {
                  const data: OpenAIChunk = {
                    id: `${id}-${index}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: (body.model as string) || "puter-model",
                    choices: [{
                      index: 0,
                      delta: {},
                      finish_reason: "error",
                    }],
                  }
                  res.write(`data: ${JSON.stringify(data)}\n\n`)
                  break
                }
                const data: OpenAIChunk = {
                  id: `${id}-${index}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: (body.model as string) || "puter-model",
                  choices: [{
                    index: 0,
                    delta: { content: chunk.text ?? "" },
                    finish_reason: chunk.done ? "stop" : null,
                  }],
                }
                res.write(`data: ${JSON.stringify(data)}\n\n`)
                index++
                if (chunk.done) break
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Stream error"
              const errorChunk: OpenAIChunk = {
                id: `${id}-${index}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: (body.model as string) || "puter-model",
                choices: [{ index: 0, delta: {}, finish_reason: "error" }],
              }
              res.write(`data: ${JSON.stringify(errorChunk)}\n\n`)
              console.error("[Puter Proxy] Stream error:", msg)
            }
            res.write("data: [DONE]\n\n")
            res.end()
          } else {
            const puterRes = await chatCompletion(puterRequest, baseURL)
            if (!puterRes.success || !puterRes.result) {
              const errMsg = puterRes.error?.message || "Puter API returned an error"
              writeError(res, 502, errMsg)
              return
            }
            const id = nextId()
            const completion: OpenAICompletion = {
              id,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: (body.model as string) || "puter-model",
              choices: [{
                index: 0,
                message: {
                  role: puterRes.result.message.role || "assistant",
                  content: puterRes.result.message.content || "",
                },
                finish_reason: "stop",
              }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            }
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify(completion))
          }
          return
        }

        writeError(res, 404, `Not found: ${method} ${url}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error"
        console.error("[Puter Proxy] Error:", msg)
        writeError(res, 500, msg)
      }
    })

    const port = desiredPort ?? 0
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"))
        return
      }
      resolve({ port: addr.port, server })
    })
    server.on("error", reject)
  })
}
