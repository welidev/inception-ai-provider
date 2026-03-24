import type { SharedV3Warning } from '@ai-sdk/provider'

export function collectUnsupportedWarnings({ topK }: { topK?: number }): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = []

    if (topK != null) {
        warnings.push({ type: 'unsupported', feature: 'topK' })
    }

    return warnings
}
