import type { LanguageModelV2FinishReason } from "@ai-sdk/provider"

export function mapInceptionFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV2FinishReason {
  switch (finishReason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "content_filter":
      return "content-filter"
    default:
      return "unknown"
  }
}
