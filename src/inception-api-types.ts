export type InceptionChatPrompt = Array<
  InceptionSystemMessage | InceptionUserMessage | InceptionAssistantMessage
>

export interface InceptionSystemMessage {
  role: "system"
  content: string
}

export interface InceptionUserMessage {
  role: "user"
  content: string
}

export interface InceptionAssistantMessage {
  role: "assistant"
  content: string
}
