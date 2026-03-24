import type { LanguageModelV1FinishReason } from "@ai-sdk/provider"

export function mapInceptionFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV1FinishReason {
  switch (finishReason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    default:
      return "unknown"
  }
}
