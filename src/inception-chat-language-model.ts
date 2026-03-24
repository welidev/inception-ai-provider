import type {
    LanguageModelV3,
    LanguageModelV3CallOptions,
    LanguageModelV3Content,
    LanguageModelV3FinishReason,
    LanguageModelV3StreamPart,
    LanguageModelV3Usage
} from '@ai-sdk/provider'
import type { ParseResult } from '@ai-sdk/provider-utils'
import type { InceptionChatModelId, InceptionChatSettings } from './inception-chat-settings.js'
import type { InceptionModelConfig } from './inception-model-config.js'
import {
    combineHeaders,
    createEventSourceResponseHandler,
    createJsonResponseHandler,
    generateId as defaultGenerateId,
    postJsonToApi
} from '@ai-sdk/provider-utils'
import { z } from 'zod'
import { collectUnsupportedWarnings } from './collect-warnings.js'
import { convertToInceptionChatMessages } from './convert-to-inception-chat-messages.js'
import { getResponseMetadata } from './get-response-metadata.js'
import { mapInceptionFinishReason } from './map-inception-finish-reason.js'
import { inceptionFailedResponseHandler } from './inception-error.js'

const InceptionChatResponseSchema = z.object({
    id: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    choices: z.array(
        z.object({
            message: z.object({
                role: z.literal('assistant').nullish(),
                content: z.string().nullish(),
                tool_calls: z
                    .array(
                        z.object({
                            id: z.string(),
                            type: z.literal('function'),
                            function: z.object({
                                name: z.string(),
                                arguments: z.string()
                            })
                        })
                    )
                    .nullish()
            }),
            finish_reason: z.string().nullish()
        })
    ),
    usage: z
        .object({
            prompt_tokens: z.number().nullish(),
            completion_tokens: z.number().nullish(),
            total_tokens: z.number().nullish()
        })
        .nullish()
})

const InceptionChatChunkSchema = z.object({
    id: z.string().nullish(),
    created: z.number().nullish(),
    model: z.string().nullish(),
    choices: z.array(
        z.object({
            delta: z
                .object({
                    role: z.enum(['assistant']).nullish(),
                    content: z.string().nullish(),
                    tool_calls: z
                        .array(
                            z.object({
                                index: z.number(),
                                id: z.string().nullish(),
                                type: z.literal('function').nullish(),
                                function: z
                                    .object({
                                        name: z.string().nullish(),
                                        arguments: z.string().nullish()
                                    })
                                    .nullish()
                            })
                        )
                        .nullish()
                })
                .nullish(),
            finish_reason: z.string().nullish()
        })
    ),
    usage: z
        .object({
            prompt_tokens: z.number().nullish(),
            completion_tokens: z.number().nullish(),
            total_tokens: z.number().nullish()
        })
        .nullish()
})

function mapUsage(
    usage:
        | {
              prompt_tokens?: number | null
              completion_tokens?: number | null
              total_tokens?: number | null
          }
        | null
        | undefined
): LanguageModelV3Usage {
    return {
        inputTokens: {
            total: usage?.prompt_tokens ?? undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined
        },
        outputTokens: {
            total: usage?.completion_tokens ?? undefined,
            text: undefined,
            reasoning: undefined
        }
    }
}

function mapToolChoice(
    toolChoice: LanguageModelV3CallOptions['toolChoice']
): string | { type: 'function'; function: { name: string } } | undefined {
    if (toolChoice == null) return undefined

    switch (toolChoice.type) {
        case 'auto':
            return 'auto'
        case 'none':
            return 'none'
        case 'required':
            return 'required'
        case 'tool':
            return { type: 'function', function: { name: toolChoice.toolName } }
        default:
            return undefined
    }
}

function mapTools(tools: LanguageModelV3CallOptions['tools']):
    | Array<{
          type: 'function'
          function: { name: string; description?: string; parameters: unknown }
      }>
    | undefined {
    if (!tools?.length) return undefined

    return tools
        .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
        .map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        }))
}

function mapResponseFormat(responseFormat: LanguageModelV3CallOptions['responseFormat']):
    | { type: 'text' }
    | {
          type: 'json_schema'
          json_schema: { name: string; strict?: boolean; schema: unknown }
      }
    | undefined {
    if (responseFormat == null) return undefined

    switch (responseFormat.type) {
        case 'text':
            return { type: 'text' }
        case 'json':
            return responseFormat.schema
                ? {
                      type: 'json_schema',
                      json_schema: {
                          name: responseFormat.name ?? 'response',
                          strict: true,
                          schema: responseFormat.schema
                      }
                  }
                : undefined
        default:
            return undefined
    }
}

export class InceptionChatLanguageModel implements LanguageModelV3 {
    readonly specificationVersion = 'v3'
    readonly supportedUrls = {}

    readonly modelId: InceptionChatModelId
    readonly settings: InceptionChatSettings

    private readonly config: InceptionModelConfig

    constructor(modelId: InceptionChatModelId, settings: InceptionChatSettings, config: InceptionModelConfig) {
        this.modelId = modelId
        this.settings = settings
        this.config = config
    }

    get provider(): string {
        return this.config.provider
    }

    private getArgs(options: LanguageModelV3CallOptions) {
        const warnings = collectUnsupportedWarnings({
            topK: options.topK
        })

        const tools = mapTools(options.tools)
        const toolChoice = mapToolChoice(options.toolChoice)
        const responseFormat = mapResponseFormat(options.responseFormat)

        const args: Record<string, unknown> = {
            model: this.modelId,
            messages: convertToInceptionChatMessages(options.prompt),
            max_tokens: options.maxOutputTokens,
            temperature: options.temperature,
            top_p: options.topP,
            stop: options.stopSequences,
            user: this.settings.user,
            ...(tools ? { tools } : {}),
            ...(toolChoice ? { tool_choice: toolChoice } : {}),
            ...(responseFormat ? { response_format: responseFormat } : {}),
            ...(this.settings.reasoningEffort ? { reasoning_effort: this.settings.reasoningEffort } : {})
        }

        return { args, warnings }
    }

    async doGenerate(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
        const { args, warnings } = this.getArgs(options)

        const { responseHeaders, value: responseBody } = await postJsonToApi({
            url: this.config.url({ path: '/v1/chat/completions' }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body: args,
            failedResponseHandler: inceptionFailedResponseHandler,
            successfulResponseHandler: createJsonResponseHandler(InceptionChatResponseSchema),
            abortSignal: options.abortSignal,
            fetch: this.config.fetch
        })

        const choice = responseBody.choices[0]

        if (!choice) {
            throw new Error('No choices returned in Inception chat response')
        }

        const content: LanguageModelV3Content[] = []

        if (choice.message.content) {
            content.push({ type: 'text', text: choice.message.content })
        }

        if (choice.message.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                content.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments
                })
            }
        }

        if (content.length === 0) {
            content.push({ type: 'text', text: '' })
        }

        return {
            content,
            finishReason: mapInceptionFinishReason(choice.finish_reason),
            usage: mapUsage(responseBody.usage),
            response: {
                ...getResponseMetadata(responseBody),
                headers: responseHeaders,
                body: responseBody
            },
            warnings,
            request: { body: args }
        }
    }

    async doStream(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
        const { args, warnings } = this.getArgs(options)
        const generateId = this.config.generateId ?? defaultGenerateId

        const requestBody = {
            ...args,
            stream: true,
            stream_options: { include_usage: true }
        }

        const { responseHeaders, value: response } = await postJsonToApi({
            url: this.config.url({ path: '/v1/chat/completions' }),
            headers: combineHeaders(this.config.headers(), options.headers),
            body: requestBody,
            failedResponseHandler: inceptionFailedResponseHandler,
            successfulResponseHandler: createEventSourceResponseHandler(InceptionChatChunkSchema),
            abortSignal: options.abortSignal,
            fetch: this.config.fetch
        })

        let finishReason: LanguageModelV3FinishReason = {
            unified: 'other',
            raw: undefined
        }
        let usage: LanguageModelV3Usage = mapUsage(undefined)
        let isFirstChunk = true
        let textId: string | undefined

        const toolCallBuffers: Map<number, { id: string; toolCallId: string; name: string; arguments: string }> =
            new Map()

        return {
            stream: response.pipeThrough(
                new TransformStream<ParseResult<z.infer<typeof InceptionChatChunkSchema>>, LanguageModelV3StreamPart>({
                    transform(chunk, controller) {
                        if (!chunk.success) {
                            finishReason = { unified: 'error', raw: undefined }
                            controller.enqueue({ type: 'error', error: chunk.error })
                            return
                        }

                        const value = chunk.value

                        if (isFirstChunk) {
                            isFirstChunk = false
                            controller.enqueue({ type: 'stream-start', warnings })
                            controller.enqueue({
                                type: 'response-metadata',
                                ...getResponseMetadata(value)
                            })
                        }

                        if (value.usage != null) {
                            usage = mapUsage(value.usage)
                        }

                        const choice = value.choices[0]

                        if (choice?.finish_reason != null) {
                            finishReason = mapInceptionFinishReason(choice.finish_reason)
                        }

                        if (choice?.delta?.content != null) {
                            if (textId == null) {
                                textId = generateId()
                                controller.enqueue({ type: 'text-start', id: textId })
                            }
                            controller.enqueue({
                                type: 'text-delta',
                                id: textId,
                                delta: choice.delta.content
                            })
                        }

                        if (choice?.delta?.tool_calls != null) {
                            for (const toolCallDelta of choice.delta.tool_calls) {
                                const idx = toolCallDelta.index

                                let buffer = toolCallBuffers.get(idx)
                                if (!buffer) {
                                    const toolCallId = toolCallDelta.id ?? generateId()
                                    buffer = {
                                        id: toolCallId,
                                        toolCallId,
                                        name: toolCallDelta.function?.name ?? '',
                                        arguments: ''
                                    }
                                    toolCallBuffers.set(idx, buffer)
                                    controller.enqueue({
                                        type: 'tool-input-start',
                                        id: buffer.toolCallId,
                                        toolName: buffer.name
                                    })
                                }

                                if (toolCallDelta.function?.arguments) {
                                    buffer.arguments += toolCallDelta.function.arguments
                                    controller.enqueue({
                                        type: 'tool-input-delta',
                                        id: buffer.id,
                                        delta: toolCallDelta.function.arguments
                                    })
                                }
                            }
                        }
                    },

                    flush(controller) {
                        if (textId != null) {
                            controller.enqueue({ type: 'text-end', id: textId })
                        }

                        for (const [, buffer] of toolCallBuffers) {
                            controller.enqueue({
                                type: 'tool-input-end',
                                id: buffer.id
                            })
                            controller.enqueue({
                                type: 'tool-call',
                                toolCallId: buffer.toolCallId,
                                toolName: buffer.name,
                                input: buffer.arguments
                            })
                        }

                        controller.enqueue({
                            type: 'finish',
                            finishReason,
                            usage
                        })
                    }
                })
            ),
            request: { body: requestBody },
            response: { headers: responseHeaders }
        }
    }
}
