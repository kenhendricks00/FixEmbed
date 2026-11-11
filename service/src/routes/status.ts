/** Status routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { findHandler } from '../handlers/index.ts';
import { assessProbeResult, type PlatformStatus } from '../utils/status.ts';
import { StatusProbeTimeoutError, StatusReportCache, withStatusProbeDeadline } from '../utils/status_report_cache.ts';

const app = new Hono<{ Bindings: Env }>();

interface PlatformStatusRow {
    platform: string;
    currentLatencyMs: number;
    status: PlatformStatus;
    mode: 'first-party' | 'fallback' | 'unavailable';
    notice: string | null;
    checkedAt: string;
    responseCode: number | null;
}

interface StatusProbe {
    platform: string;
    sampleUrl: string;
}

interface PublicStatusReport {
    updatedAt: string;
    overallStatus: PlatformStatus;
    notices: Array<{
        platform: string;
        level: PlatformStatus;
        message: string;
        updatedAt: string;
    }>;
    platforms: PlatformStatusRow[];
}

export const STATUS_PROBES: StatusProbe[] = [
    { platform: 'Twitter/X', sampleUrl: 'https://x.com/jack/status/20' },
    { platform: 'Instagram', sampleUrl: 'https://www.instagram.com/reel/DaneAqzR3eV/' },
    { platform: 'Reddit', sampleUrl: 'https://www.reddit.com/r/programming/comments/1d9m2ta/clean_code_means_good_code_performance_debate/' },
    { platform: 'Threads', sampleUrl: 'https://www.threads.com/@threads/post/DDKltrOTjJl' },
    { platform: 'Bluesky', sampleUrl: 'https://bsky.app/profile/bsky.app/post/3mqafridzgk2e' },
    { platform: 'Pixiv', sampleUrl: 'https://www.pixiv.net/en/artworks/101844438' },
    { platform: 'Bilibili', sampleUrl: 'https://www.bilibili.com/video/BV1nhZ2YHEtL' },
    { platform: 'YouTube', sampleUrl: 'https://www.youtube.com/post/UgkxAcAx0FNJNhrLMff_RLjK_d20485xSAyz' },
    { platform: 'Pinterest', sampleUrl: 'https://www.pinterest.com/pin/424605071145119869/' },
    { platform: 'TikTok', sampleUrl: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' },
    { platform: 'Tumblr', sampleUrl: 'https://changes.tumblr.com/post/817972810553196544/may-2026' },
    { platform: 'Twitch', sampleUrl: 'https://clips.twitch.tv/GoodGoodWaffleTwitchRaid' },
    { platform: 'DeviantArt', sampleUrl: 'https://www.deviantart.com/team/art/Fella-Celebrates-100k-971957229' },
];

const STATUS_PROBE_TIMEOUT_MS = 7_000;

const statusReportCache = new StatusReportCache<PublicStatusReport>();

async function runStatusProbe(env: Env, probe: StatusProbe): Promise<PlatformStatusRow> {
    const handler = findHandler(probe.sampleUrl);
    const checkedAt = new Date().toISOString();

    if (!handler) {
        return {
            platform: probe.platform,
            currentLatencyMs: 0,
            status: 'outage',
            mode: 'unavailable',
            notice: 'No handler configured for platform sample URL.',
            checkedAt,
            responseCode: null,
        };
    }

    const startedAt = Date.now();
    try {
        const result = await withStatusProbeDeadline(
            handler.handle(probe.sampleUrl, env),
            STATUS_PROBE_TIMEOUT_MS,
        );
        const latencyMs = Date.now() - startedAt;
        const assessment = assessProbeResult(result, latencyMs);

        return {
            platform: probe.platform,
            currentLatencyMs: latencyMs,
            status: assessment.status,
            mode: assessment.mode,
            notice: assessment.notice,
            checkedAt,
            responseCode: assessment.responseCode,
        };
    } catch (error) {
        const timedOut = error instanceof StatusProbeTimeoutError;
        return {
            platform: probe.platform,
            currentLatencyMs: 0,
            status: 'outage',
            mode: 'unavailable',
            notice: timedOut
                ? 'The live probe exceeded its response deadline.'
                : error instanceof Error ? error.message : 'Unknown probe error.',
            checkedAt,
            responseCode: null,
        };
    }
}

async function buildStatusReport(env: Env): Promise<PublicStatusReport> {
    const rows = await Promise.all(STATUS_PROBES.map((probe) => runStatusProbe(env, probe)));
    const hasOutage = rows.some((row) => row.status === 'outage');
    const hasDegraded = rows.some((row) => row.status === 'degraded');
    const overallStatus: PlatformStatus = hasOutage ? 'outage' : hasDegraded ? 'degraded' : 'operational';

    const activeNotices = rows
        .filter((row): row is PlatformStatusRow & { notice: string } => Boolean(row.notice))
        .map((row) => ({
            platform: row.platform,
            level: row.status,
            message: row.notice,
            updatedAt: row.checkedAt,
        }));

    return {
        updatedAt: new Date().toISOString(),
        overallStatus,
        notices: activeNotices,
        platforms: rows,
    };
}

app.get('/api/status', async (c) => {
    try {
        const result = await statusReportCache.get(() => buildStatusReport(c.env));
        const response = c.json({ ...result.value, stale: result.stale });
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('X-FixEmbed-Status-Cache', result.state.toUpperCase());
        return response;
    } catch (error) {
        console.error('status_report_refresh_failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        const response = c.json({ error: 'Live status is temporarily unavailable.' }, 503);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
});

export default app;
