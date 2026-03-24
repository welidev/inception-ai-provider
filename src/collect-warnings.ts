import type { LanguageModelV2CallWarning } from "@ai-sdk/provider"

export function collectUnsupportedWarnings({
  topK,
  frequencyPenalty,
  presencePenalty,
  responseFormat,
}: {
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  responseFormat?: { type: string }
}): LanguageModelV2CallWarning[] {
  const warnings: LanguageModelV2CallWarning[] = []

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
