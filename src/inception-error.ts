import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils'
import { z } from 'zod'

const inceptionErrorDataSchema = z.object({
    error: z.object({
        message: z.string(),
        type: z.string().nullish(),
        code: z.string().nullish()
    })
})

export type InceptionErrorData = z.infer<typeof inceptionErrorDataSchema>

export const inceptionFailedResponseHandler = createJsonErrorResponseHandler({
    errorSchema: inceptionErrorDataSchema,
    errorToMessage: data => data.error.message
})
