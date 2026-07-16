export type PlatformStatus = 'operational' | 'degraded' | 'outage';

export interface ProbeAssessment {
    status: PlatformStatus;
    mode: 'first-party' | 'fallback' | 'unavailable';
    notice: string | null;
    responseCode: number | null;
}

interface ProbeCardData {
    title?: string;
    description?: string;
    caption?: string;
    authorName?: string;
    authorHandle?: string;
    image?: string;
    images?: string[];
    video?: unknown;
}

const PROBE_CONTENT_ISSUE_PATTERNS = [
    /post not found/i,
    /not found/i,
    /returned 4\d{2}/i,
    /bad request/i,
    /invalid .*url/i,
];

const BASIC_LINK_TEXT = /^(?:view|watch|open)\b.*\b(?:on|at)\b/i;

function hasSubstantiveCardData(data: ProbeCardData): boolean {
    const hasCreator = Boolean(data.authorName?.trim() || data.authorHandle?.trim());
    const hasMedia = Boolean(data.image || data.images?.length || data.video);
    const postText = (data.caption || data.description || '').trim();
    const hasPostText = Boolean(postText && !BASIC_LINK_TEXT.test(postText));
    return hasCreator || hasMedia || hasPostText;
}

export function deriveStatusFromLatency(latencyMs: number, success: boolean): PlatformStatus {
    if (!success) return 'outage';
    if (latencyMs > 4000) return 'degraded';
    return 'operational';
}

export function assessProbeResult(
    result: {
        success: boolean;
        error?: string;
        redirect?: string;
        source?: 'first-party' | 'fallback';
        data?: ProbeCardData;
    },
    latencyMs: number,
): ProbeAssessment {
    if (result.success) {
        if (result.source === 'fallback') {
            return {
                status: 'degraded',
                mode: 'fallback',
                notice: 'Direct rendering failed; an emergency fallback supplied the embed.',
                responseCode: 200,
            };
        }
        if (result.data && !hasSubstantiveCardData(result.data)) {
            return {
                status: 'degraded',
                mode: result.source || 'first-party',
                notice: 'The probe returned only a basic link card without post metadata.',
                responseCode: 200,
            };
        }
        const status = deriveStatusFromLatency(latencyMs, true);
        return {
            status,
            mode: result.source || 'first-party',
            notice: status === 'degraded' ? `High latency observed (${latencyMs}ms).` : null,
            responseCode: 200,
        };
    }

    if (result.redirect) {
        return {
            status: 'degraded',
            mode: 'fallback',
            notice: `First-party rendering failed; emergency fallback is active${result.error ? ` (${result.error})` : '.'}`,
            responseCode: 302,
        };
    }

    const errorMessage = result.error || 'Handler failed to produce embed data.';
    const looksLikeSampleContentIssue = PROBE_CONTENT_ISSUE_PATTERNS.some((pattern) => pattern.test(errorMessage));

    return {
        status: looksLikeSampleContentIssue ? 'degraded' : 'outage',
        mode: 'unavailable',
        notice: errorMessage,
        responseCode: looksLikeSampleContentIssue ? 424 : 500,
    };
}
