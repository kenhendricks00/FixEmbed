import type { Env } from '../types.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

interface TopGgEvent {
    type: 'vote.create' | 'webhook.test';
    data?: {
        project?: {
            type?: string;
            platform?: string;
            platform_id?: string;
        };
        user?: {
            platform_id?: string;
            name?: string;
        };
    };
}

function constantTimeHexEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}

async function expectedSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${timestamp}.${rawBody}`),
    );
    return [...new Uint8Array(signature)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function verifyTopGgSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
    if (!header) return false;
    const parts = Object.fromEntries(
        header.split(',').map((part) => {
            const separator = part.indexOf('=');
            return separator > 0
                ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
                : ['', ''];
        }),
    );
    const timestamp = parts.t;
    const received = parts.v1?.toLowerCase();
    if (!timestamp || !received || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(received)) {
        return false;
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) return false;

    const expected = await expectedSignature(secret, timestamp, rawBody);
    return constantTimeHexEqual(expected, received);
}

function configured(env: Env): env is Env & Required<Pick<Env,
    'TOPGG_WEBHOOK_SECRET' | 'DISCORD_BOT_TOKEN' | 'FIXEMBED_GUILD_ID' |
    'FIXEMBED_VOTER_ROLE_ID' | 'TOPGG_BOT_ID'
>> {
    return Boolean(
        env.TOPGG_WEBHOOK_SECRET && env.DISCORD_BOT_TOKEN && env.FIXEMBED_GUILD_ID &&
        env.FIXEMBED_VOTER_ROLE_ID && env.TOPGG_BOT_ID,
    );
}

export async function handleTopGgWebhook(request: Request, env: Env): Promise<Response> {
    if (!configured(env)) return new Response('Webhook is not configured', { status: 503 });

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 });

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return new Response('Payload too large', { status: 413 });
    }
    if (!await verifyTopGgSignature(
        rawBody,
        request.headers.get('x-topgg-signature'),
        env.TOPGG_WEBHOOK_SECRET,
    )) {
        return new Response('Invalid signature', { status: 401 });
    }

    let event: TopGgEvent;
    try {
        event = JSON.parse(rawBody) as TopGgEvent;
    } catch {
        return new Response('Invalid JSON', { status: 400 });
    }

    const project = event.data?.project;
    if (
        project?.type !== 'bot' || project.platform !== 'discord' ||
        project.platform_id !== env.TOPGG_BOT_ID
    ) {
        return new Response('Unexpected project', { status: 400 });
    }
    if (event.type === 'webhook.test') return new Response(null, { status: 204 });
    if (event.type !== 'vote.create') return new Response('Unsupported event', { status: 400 });

    const userId = event.data?.user?.platform_id;
    if (!userId || !DISCORD_SNOWFLAKE.test(userId)) {
        return new Response('Invalid Discord user', { status: 400 });
    }

    const discordResponse = await fetch(
        `https://discord.com/api/v10/guilds/${env.FIXEMBED_GUILD_ID}/members/${userId}/roles/${env.FIXEMBED_VOTER_ROLE_ID}`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'DiscordBot (https://fixembed.app, 1.0)',
                'X-Audit-Log-Reason': 'Top.gg vote reward',
            },
        },
    );

    // A voter may not have joined the support server. Acknowledge the vote so
    // Top.gg does not retry an assignment that cannot succeed yet.
    if (discordResponse.status === 404) return new Response(null, { status: 204 });
    if (!discordResponse.ok) {
        console.error(`Discord voter role assignment failed with HTTP ${discordResponse.status}`);
        return new Response('Discord role assignment failed', { status: 502 });
    }
    return new Response(null, { status: 204 });
}
