# inception-ai-provider

[Vercel AI SDK](https://sdk.vercel.ai/) provider for the [Inception](https://inceptionlabs.ai) API.

Supports chat completions with streaming, tool calling, structured outputs, and reasoning effort control. Compatible with `ai@^6.0.0` (AI SDK v6 / LanguageModelV3).

## Installation

```bash
npm install inception-ai-provider ai
```

## Setup

Set your API key via environment variable:

```bash
export INCEPTION_API_KEY=your-api-key
```

Or pass it directly when creating the provider:

```ts
import { createInception } from "inception-ai-provider"

const inception = createInception({ apiKey: "your-api-key" })
```

## Usage

### Chat

```ts
import { generateText } from "ai"
import { inception } from "inception-ai-provider"

const { text } = await generateText({
  model: inception("mercury-2"),
  prompt: "What is a diffusion model?",
})
```

### Streaming

```ts
import { streamText } from "ai"
import { inception } from "inception-ai-provider"

const result = streamText({
  model: inception("mercury-2"),
  prompt: "Write a short poem.",
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

### Tool Calling

```ts
import { generateText } from "ai"
import { inception } from "inception-ai-provider"
import { z } from "zod"

const { text, toolCalls } = await generateText({
  model: inception("mercury-2"),
  prompt: "What's the weather in San Francisco?",
  tools: {
    getWeather: {
      description: "Get the current weather in a given location",
      parameters: z.object({
        location: z.string().describe("City and state, e.g. 'San Francisco, CA'"),
      }),
      execute: async ({ location }) => `72°F and sunny in ${location}`,
    },
  },
})
```

### Structured Output

```ts
import { generateObject } from "ai"
import { inception } from "inception-ai-provider"
import { z } from "zod"

const { object } = await generateObject({
  model: inception("mercury-2"),
  prompt: "Analyze the sentiment of: 'I love this product!'",
  schema: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.number().min(0).max(1),
  }),
})
```

### Reasoning Effort

```ts
import { createInception } from "inception-ai-provider"

const inception = createInception()

// Near-instant responses (skips reasoning)
const fast = inception("mercury-2", { reasoningEffort: "instant" })

// Deep reasoning
const deep = inception("mercury-2", { reasoningEffort: "high" })
```

### Configuration

```ts
const inception = createInception({
  baseURL: "https://custom-endpoint.example.com", // default: https://api.inceptionlabs.ai
  apiKey: "your-api-key",                          // default: INCEPTION_API_KEY env var
  headers: { "X-Custom": "value" },                // extra headers per request
})
```

## Compatibility

| inception-ai-provider | ai (peer dep) | Specification   |
|-----------------------|---------------|-----------------|
| `0.3.x`              | `^6.0.0`      | LanguageModelV3 |
| `0.2.x`              | `^5.0.0`      | LanguageModelV2 |
| `0.1.x`              | —             | LanguageModelV1 |

## Limitations

- **No file/image inputs** -- text only
- **No embedding models**
- **No image generation models**
- `topK` is accepted but produces a warning (not sent to API)
- Tool calling and structured outputs are only available in `0.3.x` (LanguageModelV3)

## License

MIT
