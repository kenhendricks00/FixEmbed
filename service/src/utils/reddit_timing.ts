/**
 * Per-request timing logs for the Reddit comment path (#98).
 *
 * Logging only: wrapping a fetch with `timeRedditFetch` returns or throws exactly
 * what the fetch does. Lines are buffered and written once the handler finishes,
 * one `reddit_fetch` line per upstream call plus one `reddit_comment_timing`
 * summary, so Workers Logs can show which stage made a slow card slow.
 */

export type RedditFetchStage =
    | 'probe'
    | 'json'
    | 'old_reddit'
    | 'old_reddit_body'
    | 'icon'
    | 'icon_fallback'
    | 'icon_bootstrap'
    | 'icon_retry'
    | 'icon_retry_fallback';

export type RedditCommentOutcome = 'card' | 'gone' | 'temporary' | 'error';

/** `none` means the caller has no embed cache in front of the handler. */
export type RedditEmbedCacheState = 'hit' | 'miss' | 'off' | 'none';

export interface RedditCommentIds {
    subreddit: string;
    postId: string;
    commentId: string;
}

interface RedditFetchRecord {
    stage: RedditFetchStage;
    status: number | null;
    ok: boolean;
    ms: number;
    timedOut: boolean;
    error?: string;
}

function httpStatusFromError(error: unknown): number | null {
    const message = error instanceof Error ? error.message : '';
    const match = message.match(/^HTTP (\d{3})\b/);
    return match ? Number(match[1]) : null;
}

function errorName(error: unknown): string {
    if (error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)) {
        const name = String((error as { name?: unknown }).name || 'Error');
        return /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
    }
    return 'Error';
}

function idFields(ids: RedditCommentIds) {
    return {
        subreddit: ids.subreddit,
        post_id: ids.postId,
        comment_id: ids.commentId,
    };
}

export class RedditFetchTrace {
    readonly startedAt: number;
    private readonly now: () => number;
    private readonly records: RedditFetchRecord[] = [];

    constructor(now: () => number = Date.now) {
        this.now = now;
        this.startedAt = now();
    }

    async time<T>(
        stage: RedditFetchStage,
        run: () => Promise<T>,
        statusOf?: (value: T) => number | undefined,
    ): Promise<T> {
        const start = this.now();
        try {
            const value = await run();
            const status = statusOf?.(value);
            this.records.push({
                stage,
                status: status ?? null,
                ok: status === undefined ? true : status >= 200 && status < 300,
                ms: Math.max(0, this.now() - start),
                timedOut: false,
            });
            return value;
        } catch (error) {
            const name = errorName(error);
            this.records.push({
                stage,
                status: httpStatusFromError(error),
                ok: false,
                ms: Math.max(0, this.now() - start),
                // fetchWithTimeout aborts its own controller when the timeout fires.
                timedOut: name === 'AbortError' || name === 'TimeoutError',
                error: name,
            });
            throw error;
        }
    }

    /** Write the buffered fetch lines and the summary line. */
    flush(
        ids: RedditCommentIds,
        outcome: RedditCommentOutcome,
        cache: RedditEmbedCacheState,
    ): void {
        let slowest: RedditFetchRecord | undefined;
        for (const record of this.records) {
            if (!slowest || record.ms > slowest.ms) slowest = record;
            console.log({
                event: 'reddit_fetch',
                stage: record.stage,
                status: record.status,
                ok: record.ok,
                ms: record.ms,
                timed_out: record.timedOut,
                ...(record.error ? { error: record.error } : {}),
                ...idFields(ids),
            });
        }
        console.log({
            event: 'reddit_comment_timing',
            outcome,
            cache,
            total_ms: Math.max(0, this.now() - this.startedAt),
            fetches: this.records.length,
            slowest_stage: slowest?.stage ?? null,
            slowest_ms: slowest?.ms ?? null,
            ...idFields(ids),
        });
    }
}

/** Time `run` on `trace` when there is one; otherwise just run it. */
export function timeRedditFetch<T>(
    trace: RedditFetchTrace | undefined,
    stage: RedditFetchStage,
    run: () => Promise<T>,
    statusOf?: (value: T) => number | undefined,
): Promise<T> {
    return trace ? trace.time(stage, run, statusOf) : run();
}

export const responseStatus = (response: Response): number => response.status;

/** Summary line for a comment permalink answered from the embed cache. */
export function logRedditCommentCacheHit(ids: RedditCommentIds, totalMs: number): void {
    console.log({
        event: 'reddit_comment_timing',
        outcome: 'cached',
        cache: 'hit',
        total_ms: Math.max(0, totalMs),
        fetches: 0,
        slowest_stage: null,
        slowest_ms: null,
        ...idFields(ids),
    });
}
