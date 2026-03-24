import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type { InceptionChatPrompt } from './inception-api-types.js'

export function convertToInceptionChatMessages(prompt: LanguageModelV3Prompt): InceptionChatPrompt {
    const messages: InceptionChatPrompt = []

    for (const { role, content } of prompt) {
        switch (role) {
            case 'system':
                messages.push({ role: 'system', content })
                break

            case 'user': {
                const textParts = content
                    .map(part => {
                        switch (part.type) {
                            case 'text':
                                return part.text
                            case 'file':
                                throw new UnsupportedFunctionalityError({
                                    functionality: 'File content parts in user messages'
                                })
                            default:
                                throw new UnsupportedFunctionalityError({
                                    functionality: `${(part as { type: string }).type} content parts in user messages`
                                })
                        }
                    })
                    .join('')

                messages.push({ role: 'user', content: textParts })
                break
            }

            case 'assistant': {
                let text = ''
                const toolCalls: Array<{
                    id: string
                    type: 'function'
                    function: { name: string; arguments: string }
                }> = []

                for (const part of content) {
                    switch (part.type) {
                        case 'text':
                            text += part.text
                            break
                        case 'tool-call':
                            toolCalls.push({
                                id: part.toolCallId,
                                type: 'function',
                                function: {
                                    name: part.toolName,
                                    arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input)
                                }
                            })
                            break
                        default:
                            throw new UnsupportedFunctionalityError({
                                functionality: `${(part as { type: string }).type} content parts in assistant messages`
                            })
                    }
                }

                messages.push({
                    role: 'assistant',
                    content: text || null,
                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                })
                break
            }

            case 'tool':
                for (const part of content) {
                    if (part.type !== 'tool-result') continue
                    messages.push({
                        role: 'tool',
                        content: JSON.stringify(part.output),
                        tool_call_id: part.toolCallId
                    })
                }
                break

            default: {
                const _exhaustiveCheck: never = role
                throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
            }
        }
    }

    return messages
}
