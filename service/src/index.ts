/** Compose the public Worker routes and shared request middleware. */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types.ts';
import site from './routes/site.ts';
import status from './routes/status.ts';
import activity from './routes/activity.ts';
import embeds from './routes/embeds.ts';
import media from './routes/media.ts';
import platforms from './routes/platforms.ts';
import { handleTopGgWebhook } from './webhooks/topgg.ts';
import { redactInstagramVideoRelayRequestLog } from './routes/instagram_video_relay.ts';

export { STATUS_PROBES } from './routes/status.ts';

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());
app.use('*', logger((message) => console.log(redactInstagramVideoRelayRequestLog(message))));
app.post('/webhooks/topgg', (c) => handleTopGgWebhook(c.req.raw, c.env));

app.route('/', site);
app.route('/', status);
app.route('/', activity);
app.route('/', embeds);
app.route('/', media);
// Diagnostic handlers were disabled in production. Keep their 404 contract.
app.use('/debug/*', async (c) => c.notFound());
app.route('/', platforms);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
    console.error('Server error:', error);
    return c.json({ error: 'Internal server error' }, 500);
});

export default app;
