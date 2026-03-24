import type {
  APICallError,
  LanguageModelV1,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider"
import type {
  ParseResult,
  ResponseHandler,
} from "@ai-sdk/provider-utils"
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
    })
    .nullish(),
})

export class InceptionChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1"
  readonly defaultObjectGenerationMode = undefined
  readonly supportsStructuredOutputs = false

  readonly modelId: InceptionChatModelId
  readonly settings: InceptionChatSettings

  private readonly config: InceptionModelConfig
  private readonly failedResponseHandler: ResponseHandler<APICallError>

  constructor(
    modelId: InceptionChatModelId,
    settings: InceptionChatSettings,
    config: InceptionModelConfig,
  ) {
    this.modelId = modelId
    this.settings = settings
    this.config = config
    this.failedResponseHandler = inceptionFailedResponseHandler
  }

  get provider(): string {
    return this.config.provider
  }

  private getArgs({
    mode,
    prompt,
    maxTokens,
    temperature,
    stopSequences,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    responseFormat,
  }: Parameters<LanguageModelV1["doGenerate"]>[0]) {
    const type = mode.type
    const warnings = collectUnsupportedWarnings({
      topK,
      frequencyPenalty,
      presencePenalty,
      responseFormat,
    })

    const baseArgs: Record<string, unknown> = {
      model: this.modelId,
      messages: convertToInceptionChatMessages(prompt),
      max_completion_tokens: maxTokens,
      temperature,
      top_p: topP,
      stop: stopSequences,
      user: this.settings.user,
      ...(this.settings.reasoningEffort
        ? { reasoning_effort: this.settings.reasoningEffort }
        : {}),
    }

    switch (type) {
      case "regular": {
        if (mode.tools?.length) {
          throw new UnsupportedFunctionalityError({
            functionality: "tools",
          })
        }
        if (mode.toolChoice) {
          throw new UnsupportedFunctionalityError({
            functionality: "toolChoice",
          })
        }
        return { args: baseArgs, warnings }
      }

      case "object-json":
        throw new UnsupportedFunctionalityError({
          functionality: "object-json mode",
        })

      case "object-tool":
        throw new UnsupportedFunctionalityError({
          functionality: "object-tool mode",
        })

      default: {
        const _exhaustiveCheck: never = type
        throw new Error(`Unsupported type: ${_exhaustiveCheck}`)
      }
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV1["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1["doGenerate"]>>> {
    const { args, warnings } = this.getArgs(options)

    const { responseHeaders, value: responseBody } = await postJsonToApi({
      url: this.config.url({ path: "/v1/chat/completions" }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        InceptionChatResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const { messages: rawPrompt, ...rawSettings } = args
    const choice = responseBody.choices[0]

    if (!choice) {
      throw new Error("No choices returned in Inception chat response")
    }

    return {
      text: choice.message.content ?? undefined,
      finishReason: mapInceptionFinishReason(choice.finish_reason),
      usage: {
        promptTokens: responseBody.usage?.prompt_tokens ?? Number.NaN,
        completionTokens:
          responseBody.usage?.completion_tokens ?? Number.NaN,
      },
      rawCall: { rawPrompt, rawSettings },
      rawResponse: { headers: responseHeaders },
      response: getResponseMetadata(responseBody),
      warnings,
      request: { body: JSON.stringify(args) },
    }
  }

  async doStream(
    options: Parameters<LanguageModelV1["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1["doStream"]>>> {
    const { args, warnings } = this.getArgs(options)

    const requestBody = {
      ...args,
      stream: true,
      stream_options: { include_usage: true },
    }

    const body = JSON.stringify(requestBody)

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({ path: "/v1/chat/completions" }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: requestBody,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler:
        createEventSourceResponseHandler(InceptionChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const { messages: rawPrompt, ...rawSettings } = args

    let finishReason: LanguageModelV1FinishReason = "unknown"
    let usage: {
      promptTokens: number | undefined
      completionTokens: number | undefined
    } = {
      promptTokens: undefined,
      completionTokens: undefined,
    }
    let isFirstChunk = true

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof InceptionChatChunkSchema>>,
          LanguageModelV1StreamPart
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
              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata(value),
              })
            }

            if (value.usage != null) {
              usage = {
                promptTokens: value.usage.prompt_tokens ?? undefined,
                completionTokens:
                  value.usage.completion_tokens ?? undefined,
              }
            }

            const choice = value.choices[0]

            if (choice?.finish_reason != null) {
              finishReason = mapInceptionFinishReason(choice.finish_reason)
            }

            if (choice?.delta?.content != null) {
              controller.enqueue({
                type: "text-delta",
                textDelta: choice.delta.content,
              })
            }
          },

          flush(controller) {
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: {
                promptTokens: usage.promptTokens ?? Number.NaN,
                completionTokens: usage.completionTokens ?? Number.NaN,
              },
            })
          },
        }),
      ),
      rawCall: { rawPrompt, rawSettings },
      rawResponse: { headers: responseHeaders },
      warnings,
      request: { body },
    }
  }
}
