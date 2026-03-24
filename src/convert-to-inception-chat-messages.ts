import type { LanguageModelV2Prompt } from "@ai-sdk/provider"
import { UnsupportedFunctionalityError } from "@ai-sdk/provider"
import type { InceptionChatPrompt } from "./inception-api-types.js"

export function convertToInceptionChatMessages(
  prompt: LanguageModelV2Prompt,
): InceptionChatPrompt {
  const messages: InceptionChatPrompt = []

  for (const { role, content } of prompt) {
    switch (role) {
      case "system":
        messages.push({ role: "system", content })
        break

      case "user": {
        const textParts = content
          .map((part) => {
            switch (part.type) {
              case "text":
                return part.text
              case "file":
                throw new UnsupportedFunctionalityError({
                  functionality: "File content parts in user messages",
                })
              default:
                throw new UnsupportedFunctionalityError({
                  functionality: `${(part as { type: string }).type} content parts in user messages`,
                })
            }
          })
          .join("")

        messages.push({ role: "user", content: textParts })
        break
      }

      case "assistant": {
        let text = ""
        for (const part of content) {
          switch (part.type) {
            case "text":
              text += part.text
              break
            case "tool-call":
              throw new UnsupportedFunctionalityError({
                functionality: "Tool call content parts in assistant messages",
              })
            default:
              throw new UnsupportedFunctionalityError({
                functionality: `${(part as { type: string }).type} content parts in assistant messages`,
              })
          }
        }
        messages.push({ role: "assistant", content: text })
        break
      }

      case "tool":
        throw new UnsupportedFunctionalityError({
          functionality: "Tool messages",
        })

      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return messages
}
