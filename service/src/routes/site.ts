/** Site routes. */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { indexHtml, platformLandingHtml, scriptJs, stylesCss, privacyHtml, tosHtml, docsHtml, supportHtml, statusHtml } from '../utils/static_site.ts';
import { discordInstallUrl, parseInstallContext, parseInstallSource } from '../utils/install.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
    return c.html(indexHtml);
});

app.get('/install/:context/:source', (c) => {
    const context = parseInstallContext(c.req.param('context'));
    const source = parseInstallSource(c.req.param('source'));
    if (!context || !source) {
        return c.json({ error: 'Not found' }, 404);
    }

    console.info('install_redirect', { context, source });
    return c.redirect(discordInstallUrl(context), 302);
});

for (const platform of ['twitter', 'instagram', 'reddit'] as const) {
    app.get(`/${platform}`, (c) => c.html(platformLandingHtml(platform)));
}

app.get('/styles.css', (c) => {
    return c.text(stylesCss, 200, {
        'Content-Type': 'text/css',
    });
});

app.get('/script.js', (c) => {
    return c.text(scriptJs, 200, {
        'Content-Type': 'application/javascript',
    });
});

app.get('/tos', (c) => {
    return c.html(tosHtml);
});

app.get('/privacy', (c) => {
    return c.html(privacyHtml);
});

app.get('/docs', (c) => {
    return c.html(docsHtml);
});

app.get('/support', (c) => {
    return c.html(supportHtml);
});

app.get('/status', (c) => {
    return c.html(statusHtml);
});

app.get('/donate', (c) => {
    return c.redirect('/support', 301);
});

export default app;
