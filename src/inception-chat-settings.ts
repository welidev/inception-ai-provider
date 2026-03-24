export type InceptionChatModelId = "mercury-2" | (string & {})

export interface InceptionChatSettings {
  /**
   * Controls the amount of reasoning the model performs.
   * - `instant`: Near-instant responses, ideal for real-time use cases
   * - `low` / `medium` / `high`: Increasing reasoning depth
   */
  reasoningEffort?: "instant" | "low" | "medium" | "high"

  /**
   * A unique identifier representing the end-user, which can help
   * the provider to monitor and detect abuse.
   */
  user?: string
}
