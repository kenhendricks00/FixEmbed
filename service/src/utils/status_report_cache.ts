export type StatusReportCacheState = 'miss' | 'hit' | 'coalesced' | 'stale';

export interface StatusReportCacheResult<T> {
    value: T;
    state: StatusReportCacheState;
    stale: boolean;
}

interface StatusReportCacheOptions {
    freshTtlMs?: number;
    staleTtlMs?: number;
    now?: () => number;
}

const DEFAULT_FRESH_TTL_MS = 60_000;
const DEFAULT_STALE_TTL_MS = 15 * 60_000;

/**
 * Keep status fan-out bounded inside a warm Worker isolate. Concurrent callers
 * share one refresh and a transient refresh failure may reuse only recent,
 * previously verified data.
 */
export class StatusReportCache<T> {
    private readonly freshTtlMs: number;
    private readonly staleTtlMs: number;
    private readonly now: () => number;
    private value?: T;
    private cachedAt = Number.NEGATIVE_INFINITY;
    private inFlight?: Promise<T>;

    constructor(options: StatusReportCacheOptions = {}) {
        this.freshTtlMs = options.freshTtlMs ?? DEFAULT_FRESH_TTL_MS;
        this.staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
        this.now = options.now ?? Date.now;
        if (
            !Number.isFinite(this.freshTtlMs)
            || this.freshTtlMs < 0
            || !Number.isFinite(this.staleTtlMs)
            || this.staleTtlMs < this.freshTtlMs
        ) {
            throw new RangeError('Status cache TTLs must be finite and stale TTL must cover fresh TTL');
        }
    }

    private recentEnough(maxAgeMs: number): boolean {
        return this.value !== undefined && this.now() - this.cachedAt <= maxAgeMs;
    }

    private staleResult(): StatusReportCacheResult<T> | undefined {
        if (!this.recentEnough(this.staleTtlMs) || this.value === undefined) return undefined;
        return { value: this.value, state: 'stale', stale: true };
    }

    async get(refresh: () => Promise<T>): Promise<StatusReportCacheResult<T>> {
        if (this.recentEnough(this.freshTtlMs) && this.value !== undefined) {
            return { value: this.value, state: 'hit', stale: false };
        }

        if (this.inFlight) {
            try {
                return {
                    value: await this.inFlight,
                    state: 'coalesced',
                    stale: false,
                };
            } catch (error) {
                const stale = this.staleResult();
                if (stale) return stale;
                throw error;
            }
        }

        let pending: Promise<T>;
        try {
            pending = refresh();
        } catch (error) {
            const stale = this.staleResult();
            if (stale) return stale;
            throw error;
        }
        this.inFlight = pending;
        try {
            const value = await pending;
            this.value = value;
            this.cachedAt = this.now();
            return { value, state: 'miss', stale: false };
        } catch (error) {
            const stale = this.staleResult();
            if (stale) return stale;
            throw error;
        } finally {
            if (this.inFlight === pending) this.inFlight = undefined;
        }
    }
}

export class StatusProbeTimeoutError extends Error {
    constructor() {
        super('Status probe exceeded its deadline');
        this.name = 'StatusProbeTimeoutError';
    }
}

export async function withStatusProbeDeadline<T>(
    work: Promise<T>,
    timeoutMs: number,
): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('Status probe timeout must be a positive finite number');
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new StatusProbeTimeoutError()), timeoutMs);
    });
    try {
        return await Promise.race([work, deadline]);
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
}
