export type InceptionChatPrompt = Array<
    InceptionSystemMessage | InceptionUserMessage | InceptionAssistantMessage | InceptionToolMessage
>

export interface InceptionSystemMessage {
    role: 'system'
    content: string
}

export interface InceptionUserMessage {
    role: 'user'
    content: string
}

export interface InceptionAssistantMessage {
    role: 'assistant'
    content: string | null
    tool_calls?: InceptionToolCall[]
}

export interface InceptionToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface InceptionToolMessage {
    role: 'tool'
    content: string
    tool_call_id: string
}
