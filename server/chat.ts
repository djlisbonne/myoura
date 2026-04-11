import OpenAI from 'openai'

import { DEFAULT_MODEL, chatRequestSchema, safeJsonStringify, type ChatContext, type ChatRequestBody } from './lib.js'

export interface ChatResult {
  answer: string
  model: string
  contextInjected: boolean
}

function formatHistory(history: NonNullable<ChatRequestBody['history']>): string {
  if (history.length === 0) {
    return ''
  }
  return history
    .map((message) => `${message.role.toUpperCase()}: ${message.content.trim()}`)
    .join('\n')
}

function buildInstructions(screenContext?: ChatContext): string {
  const sections = [
    'You are a health-data analysis assistant for a local Oura dashboard.',
    'Use the provided local data context as the source of truth.',
    'Be clear, interpretive, and concise.',
    'Do not invent values that are not present in the data context.',
    'Do not provide medical diagnosis or emergency guidance; encourage professional care for urgent concerns.',
  ]

  if (screenContext) {
    sections.push(`Visible screen context:\n${safeJsonStringify(screenContext, 2, 12000)}`)
  }

  return sections.join('\n\n')
}

export function parseChatRequest(body: unknown): ChatRequestBody {
  return chatRequestSchema.parse(body)
}

export async function runChatCompletion(body: ChatRequestBody): Promise<ChatResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const client = new OpenAI({ apiKey })
  const model = body.model ?? DEFAULT_MODEL
  const instructions = buildInstructions(body.screenContext)
  const historyText = body.history ? `${formatHistory(body.history)}\n\n` : ''
  const input = `${historyText}USER: ${body.message.trim()}`

  const response = await client.responses.create({
    model,
    instructions,
    input,
    temperature: body.temperature ?? 0.2,
    max_output_tokens: body.maxOutputTokens ?? 1200,
  })

  const answer = typeof response.output_text === 'string' && response.output_text.trim().length > 0 ? response.output_text.trim() : 'No response was generated.'

  return {
    answer,
    model,
    contextInjected: Boolean(body.screenContext),
  }
}

