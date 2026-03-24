import type { LanguageModelV1CallWarning } from "@ai-sdk/provider"

export function collectUnsupportedWarnings({
  topK,
  frequencyPenalty,
  presencePenalty,
  responseFormat,
}: {
  topK?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  responseFormat?: { type: string } | null
}): LanguageModelV1CallWarning[] {
  const warnings: LanguageModelV1CallWarning[] = []

  if (topK != null) {
    warnings.push({ type: "unsupported-setting", setting: "topK" })
  }

  if (frequencyPenalty != null) {
    warnings.push({ type: "unsupported-setting", setting: "frequencyPenalty" })
  }

  if (presencePenalty != null) {
    warnings.push({ type: "unsupported-setting", setting: "presencePenalty" })
  }

  if (responseFormat != null && responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      setting: "responseFormat",
      details: "JSON response format is not supported.",
    })
  }

  return warnings
}
