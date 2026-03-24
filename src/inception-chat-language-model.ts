import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import type { ParseResult } from "@ai-sdk/provider-utils"
import type {
  InceptionChatModelId,
  InceptionChatSettings,
} from "./inception-chat-settings.js"
import type { InceptionModelConfig } from "./inception-model-config.js"
import { UnsupportedFunctionalityError } from "@ai-sdk/provider"
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId as defaultGenerateId,
  postJsonToApi,
} from "@ai-sdk/provider-utils"
import { z } from "zod"
import { collectUnsupportedWarnings } from "./collect-warnings.js"
import { convertToInceptionChatMessages } from "./convert-to-inception-chat-messages.js"
import { getResponseMetadata } from "./get-response-metadata.js"
import { mapInceptionFinishReason } from "./map-inception-finish-reason.js"
import { inceptionFailedResponseHandler } from "./inception-error.js"

const InceptionChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant").nullish(),
        content: z.string().nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
    })
    .nullish(),
})

const InceptionChatChunkSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      delta: z
        .object({
          role: z.enum(["assistant"]).nullish(),
          content: z.string().nullish(),
        })
        .nullish(),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
    })
    .nullish(),
})

export class InceptionChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly supportedUrls = {}

  readonly modelId: InceptionChatModelId
  readonly settings: InceptionChatSettings

  private readonly config: InceptionModelConfig

  constructor(
    modelId: InceptionChatModelId,
    settings: InceptionChatSettings,
    config: InceptionModelConfig,
  ) {
    this.modelId = modelId
    this.settings = settings
    this.config = config
  }

  get provider(): string {
    return this.config.provider
  }

  private getArgs(options: LanguageModelV2CallOptions) {
    const warnings = collectUnsupportedWarnings({
      topK: options.topK,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      responseFormat: options.responseFormat,
    })

    if (options.tools?.length) {
      throw new UnsupportedFunctionalityError({
        functionality: "tools",
      })
    }
    if (options.toolChoice) {
      throw new UnsupportedFunctionalityError({
        functionality: "toolChoice",
      })
    }

    const args: Record<string, unknown> = {
      model: this.modelId,
      messages: convertToInceptionChatMessages(options.prompt),
      max_completion_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stop: options.stopSequences,
      user: this.settings.user,
      ...(this.settings.reasoningEffort
        ? { reasoning_effort: this.settings.reasoningEffort }
        : {}),
    }

    return { args, warnings }
  }

  async doGenerate(
    options: LanguageModelV2CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const { args, warnings } = this.getArgs(options)

    const { responseHeaders, value: responseBody } = await postJsonToApi({
      url: this.config.url({ path: "/v1/chat/completions" }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: inceptionFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        InceptionChatResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const choice = responseBody.choices[0]

    if (!choice) {
      throw new Error("No choices returned in Inception chat response")
    }

    return {
      content: [{ type: "text", text: choice.message.content ?? "" }],
      finishReason: mapInceptionFinishReason(choice.finish_reason),
      usage: {
        inputTokens: responseBody.usage?.prompt_tokens ?? undefined,
        outputTokens: responseBody.usage?.completion_tokens ?? undefined,
        totalTokens: responseBody.usage?.total_tokens ?? undefined,
      },
      response: {
        ...getResponseMetadata(responseBody),
        headers: responseHeaders,
        body: responseBody,
      },
      warnings,
      request: { body: args },
    }
  }

  async doStream(
    options: LanguageModelV2CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const { args, warnings } = this.getArgs(options)
    const generateId = this.config.generateId ?? defaultGenerateId

    const requestBody = {
      ...args,
      stream: true,
      stream_options: { include_usage: true },
    }

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({ path: "/v1/chat/completions" }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: requestBody,
      failedResponseHandler: inceptionFailedResponseHandler,
      successfulResponseHandler:
        createEventSourceResponseHandler(InceptionChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    let finishReason: LanguageModelV2FinishReason = "unknown"
    let usage: {
      inputTokens: number | undefined
      outputTokens: number | undefined
      totalTokens: number | undefined
    } = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    }
    let isFirstChunk = true
    let textId: string | undefined

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof InceptionChatChunkSchema>>,
          LanguageModelV2StreamPart
        >({
          transform(chunk, controller) {
            if (!chunk.success) {
              finishReason = "error"
              controller.enqueue({ type: "error", error: chunk.error })
              return
            }

            const value = chunk.value

            if (isFirstChunk) {
              isFirstChunk = false
              controller.enqueue({ type: "stream-start", warnings })
              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata(value),
              })
            }

            if (value.usage != null) {
              usage = {
                inputTokens: value.usage.prompt_tokens ?? undefined,
                outputTokens: value.usage.completion_tokens ?? undefined,
                totalTokens: value.usage.total_tokens ?? undefined,
              }
            }

            const choice = value.choices[0]

            if (choice?.finish_reason != null) {
              finishReason = mapInceptionFinishReason(choice.finish_reason)
            }

            if (choice?.delta?.content != null) {
              if (textId == null) {
                textId = generateId()
                controller.enqueue({ type: "text-start", id: textId })
              }
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: choice.delta.content,
              })
            }
          },

          flush(controller) {
            if (textId != null) {
              controller.enqueue({ type: "text-end", id: textId })
            }
            controller.enqueue({
              type: "finish",
              finishReason,
              usage,
            })
          },
        }),
      ),
      request: { body: requestBody },
      response: { headers: responseHeaders },
    }
  }
}
