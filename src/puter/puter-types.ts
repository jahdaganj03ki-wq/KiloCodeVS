export const PUTER_BASE_URL = "https://api.puter.com"
export const PUTER_PROVIDER_ID = "puter"

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
    tools?: Array<Record<string, unknown>>
  }
  auth_token: string
  test_mode?: boolean
}

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

export interface PuterStreamChunk {
  text?: string
  done?: boolean
  error?: { message: string; code?: string }
}

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

export interface PuterApiError {
  success: false
  error: { message: string; code?: string }
}

export interface OpenAICompatibleModel {
  id: string
  name: string
  object: "model"
  created: number
  owned_by: string
}

export interface OpenAICompatibleModelList {
  object: "list"
  data: OpenAICompatibleModel[]
}

export interface OpenAIChunkChoice {
  index: number
  delta: { content?: string; role?: string }
  finish_reason: string | null
}

export interface OpenAIChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: OpenAIChunkChoice[]
}

export interface OpenAIMessage {
  role: string
  content: string
}

export interface OpenAIChoice {
  index: number
  message: OpenAIMessage
  finish_reason: string | null
}

export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface OpenAICompletion {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: OpenAIChoice[]
  usage: OpenAIUsage
}

export interface OpenAIError {
  error: {
    message: string
    type: string
    param: string | null
    code: string | null
  }
}
