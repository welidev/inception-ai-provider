export type InceptionChatModelId = 'mercury-2' | (string & {})

export type InceptionReasoningEffort = 'instant' | 'low' | 'medium' | 'high'

export interface InceptionChatSettings {
    /**
     * Controls the amount of reasoning the model performs.
     * - `instant`: Near-instant responses, ideal for real-time use cases
     * - `low` / `medium` / `high`: Increasing reasoning depth
     */
    reasoningEffort?: InceptionReasoningEffort

    /**
     * A unique identifier representing the end-user, which can help
     * the provider to monitor and detect abuse.
     */
    user?: string
}
