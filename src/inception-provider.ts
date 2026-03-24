import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import type { InceptionChatModelId, InceptionChatSettings } from './inception-chat-settings.js'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { InceptionChatLanguageModel } from './inception-chat-language-model.js'

export interface InceptionProvider extends ProviderV3 {
    (modelId: InceptionChatModelId, settings?: InceptionChatSettings): LanguageModelV3

    chatModel: (modelId: InceptionChatModelId, settings?: InceptionChatSettings) => LanguageModelV3

    languageModel: (modelId: InceptionChatModelId, settings?: InceptionChatSettings) => LanguageModelV3
}

export interface InceptionProviderSettings {
    /**
     * Base URL for the Inception API.
     * @default "https://api.inceptionlabs.ai"
     */
    baseURL?: string

    /**
     * API key for the Inception API. Falls back to the `INCEPTION_API_KEY`
     * environment variable.
     */
    apiKey?: string

    /**
     * Extra headers to include in every request.
     */
    headers?: Record<string, string>

    /**
     * Custom fetch implementation. Useful for proxies or testing.
     */
    fetch?: FetchFunction
}

export function createInception(options: InceptionProviderSettings = {}): InceptionProvider {
    const baseURL = withoutTrailingSlash(options.baseURL ?? 'https://api.inceptionlabs.ai')

    const getHeaders = () => ({
        Authorization: `Bearer ${loadApiKey({
            apiKey: options.apiKey,
            environmentVariableName: 'INCEPTION_API_KEY',
            description: 'Inception API key'
        })}`,
        ...options.headers
    })

    const getCommonConfig = (modelType: string) => ({
        provider: `inception.${modelType}`,
        url: ({ path }: { path: string }) => `${baseURL}${path}`,
        headers: getHeaders,
        fetch: options.fetch
    })

    const createChatModel = (modelId: InceptionChatModelId, settings: InceptionChatSettings = {}) =>
        new InceptionChatLanguageModel(modelId, settings, getCommonConfig('chat'))

    const provider = (modelId: InceptionChatModelId, settings?: InceptionChatSettings) =>
        createChatModel(modelId, settings)

    provider.chatModel = createChatModel
    provider.languageModel = createChatModel
    provider.specificationVersion = 'v3'
    provider.embeddingModel = () => {
        throw new Error('Inception does not support embedding models.')
    }
    provider.imageModel = () => {
        throw new Error('Inception does not support image models.')
    }

    return provider as InceptionProvider
}

export const inception = createInception()
