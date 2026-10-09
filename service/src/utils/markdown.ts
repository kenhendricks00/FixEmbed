/**
 * Convert rendered Reddit comment/post HTML (old.reddit `.md` blocks and new
 * Reddit rtjson content) into Discord markdown.
 *
 * Reddit's JSON API hands us the author's markdown, which Discord already
 * understands. The crawler fallback only has Reddit's rendered HTML, where the
 * author's escapes are gone (`how\_are` became `how_are`) and inline code is a
 * `<code>` tag. Stripping tags turned that back into live Discord markdown, so
 * underscores started italics and `<code>_</code>` vanished (#87).
 *
 * Text nodes are escaped exactly once here. Formatting comes only from the
 * HTML tags, so the result matches what the JSON path returns for the same
 * comment and downstream renderers (the bot's quote block, bold labels) must
 * not escape it again.
 */

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: '\u00a0',
};

/**
 * Characters that must never reach a Discord card (#90): C0 controls other than
 * tab and newline, DEL, C1 controls, and the bidi embedding, override and
 * isolate marks (U+202A to U+202E, U+2066 to U+2069). An override such as
 * `&#x202E;` flips the rest of the card's text, and U+0000 is the converter's
 * own placeholder marker. Line separators and LRM/RLM stay: they don't reorder
 * text past their own line.
 */
const UNSAFE_TEXT_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Decode one layer of HTML entities in a text node. Reddit's double-encoded
 * `&amp;gt;` is the author's literal `&gt;`, so it stays `&gt;` (same rule as
 * the crawler's exactly-once decoding in #84). Control and bidi characters are
 * dropped afterwards, whether they were written literally or as a numeric
 * entity (#90). This is the only HTML text decoder; the crawler uses it too.
 */
export function decodeHtmlText(value: string): string {
    return stripUnsafeText(decodeEntitiesOnce(value));
}

/** Drop control and bidi characters from text bound for a card (#90). */
export function stripUnsafeText(value: string): string {
    return value.replace(UNSAFE_TEXT_CHARACTERS, '');
}

function decodeEntitiesOnce(value: string): string {
    return value.replace(
        /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g,
        (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
            if (name !== undefined) {
                return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
                    ? NAMED_ENTITIES[name]
                    : entity;
            }
            const codePoint = decimal !== undefined
                ? Number.parseInt(decimal, 10)
                : Number.parseInt(hex!, 16);
            if (
                !Number.isFinite(codePoint)
                || codePoint === 0
                || codePoint > 0x10ffff
                || (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ) {
                return entity;
            }
            return String.fromCodePoint(codePoint);
        },
    );
}

const INLINE_MARKDOWN = /[\\*_~`|]/g;
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

/**
 * Escape plain text for Discord markdown. URLs stay untouched so their
 * underscores keep working; `atLineStart` also escapes block markers
 * (`#`, `>`, `-`, `+`, `1.`) at the start of the first line.
 */
export function escapeDiscordMarkdown(text: string, atLineStart = true): string {
    return text
        .split('\n')
        .map((line, index) => {
            const escaped = line
                .split(URL_PATTERN)
                .map((part, partIndex) => (
                    partIndex % 2 === 1
                        ? part
                        // `\](` keeps a typed `[x](url)` from becoming a live link (#96).
                        : part.replace(INLINE_MARKDOWN, '\\$&').replace(/\](?=\()/g, '\\]')
                ))
                .join('');
            if (index === 0 && !atLineStart) return escaped;
            return escaped
                .replace(/^([ \t]*)([#>+-])/, '$1\\$2')
                .replace(/^([ \t]*\d+)\./, '$1\\.');
        })
        .join('\n');
}

function tagAttribute(tag: string, name: string): string {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return decodeHtmlText(match?.[1] ?? match?.[2] ?? '');
}

function inlineCode(code: string): string {
    if (!code) return '';
    // Discord only has single and double backtick fences, so a run of two or
    // more backticks inside the code is broken with zero-width spaces (#96).
    const safe = code.replace(/`{2,}/g, (run) => run.split('').join('\u200b'));
    const fence = safe.includes('`') ? '``' : '`';
    const pad = safe.startsWith('`') || safe.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${safe}${pad}${fence}`;
}

/** A fenced block; the caller adds the blank lines around it. */
function codeBlock(code: string): string {
    const body = code.replace(/^\n+|\n+$/g, '');
    return body ? `\`\`\`\n${body.replace(/```/g, '`\u200b``')}\n\`\`\`` : '';
}

/** encodeURIComponent leaves `(` and `)` alone, and a `)` ends the link (#96). */
function maskedLinkUrl(href: string): string {
    return href.replace(/[()\s]/g, (char) => (
        char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char)
    ));
}

/** Reddit-relative `/r/...` and `/u/...` hrefs point at reddit.com (#96). */
function absoluteRedditHref(href: string): string {
    if (/^\/(?!\/)/.test(href)) return `https://www.reddit.com${href}`;
    if (href.startsWith('//')) return `https:${href}`;
    return href;
}

const FULLWIDTH_BRACKETS: Record<string, string> = { '[': '\uff3b', ']': '\uff3d' };

/**
 * Link text Discord keeps as a masked-link label, or undefined when it would
 * refuse one (#96, same rules as the bot's markdown_safety from #103): escapes
 * show literally there, so they are dropped; mentions use a fullwidth `\uff20`/`\uff03`;
 * only simple `[..]` pairs keep ASCII brackets; and a label with `//` in it (a
 * URL) is refused outright. `visible` is the label with code spans restored.
 */
function maskedLinkLabel(inner: string, visible: (label: string) => string): string | undefined {
    let label = inner
        .replace(/\\([\\*_~`|[\]#>+\-.!()])/g, '$1')
        .replace(/\s*\n+\s*/g, ' ')
        .trim()
        .replace(/@(everyone|here)/g, '\uff20$1')
        .replace(/<([@#])/g, (_, sigil: string) => `<${sigil === '@' ? '\uff20' : '\uff03'}`);
    let paired = '';
    let cursor = 0;
    for (const match of label.matchAll(/\[[^[\]]*\](?!\()/g)) {
        paired += label.slice(cursor, match.index).replace(/[[\]]/g, (b) => FULLWIDTH_BRACKETS[b]);
        paired += match[0];
        cursor = match.index + match[0].length;
    }
    label = (paired + label.slice(cursor).replace(/[[\]]/g, (b) => FULLWIDTH_BRACKETS[b]))
        .replace(/\\(?=[[\]]|$)/g, '\uff3c');
    const shown = visible(label);
    if (!shown.trim() || shown.normalize('NFKC').includes('//') || /[[\]]/.test(shown.replace(/\[[^[\]]*\]/g, ''))) {
        return undefined;
    }
    return label;
}

/** True when text has nothing a reader could see (#96: a `&#x200B;`-only body). */
export function isInvisibleText(text: string): boolean {
    return !text.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '');
}

const ELLIPSIS = '...';
const FENCE_CLOSER = '\n```';

/**
 * truncateText for Discord markdown: a cut inside a code block closes the block,
 * so the rest of the card doesn't render as code (#96).
 */
export function truncateMarkdown(text: string, maxLength = 3000): string {
    if (text.length <= maxLength) return text;
    const fences = (value: string) => (value.match(/```/g) || []).length;
    let cut = text.slice(0, maxLength - ELLIPSIS.length).replace(/`+$/, '');
    if (fences(cut) % 2 === 0) return `${cut}${ELLIPSIS}`;
    cut = text.slice(0, maxLength - ELLIPSIS.length - FENCE_CLOSER.length).replace(/`+$/, '');
    return fences(cut) % 2 === 1 ? `${cut}${ELLIPSIS}${FENCE_CLOSER}` : `${cut}${ELLIPSIS}`;
}

type OpenLink = { href: string; start: number; text: string };
type OpenTag = { name: string; closer: string };

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

export function redditHtmlToDiscordMarkdown(html: string): string {
    let out = '';
    const protectedSegments: string[] = [];
    const links: OpenLink[] = [];
    const openTags: OpenTag[] = [];
    let preDepth = 0;
    let code: string | undefined;

    const quoteStarts: number[] = [];

    const protect = (segment: string) => {
        if (!segment) return;
        protectedSegments.push(segment);
        out += `\u0000${protectedSegments.length - 1}\u0000`;
    };
    const restore = (value: string) => value.replace(
        PLACEHOLDER,
        (_, index: string) => protectedSegments[Number(index)] ?? '',
    );
    const atLineStart = () => out === '' || /\n[ \t]*$/.test(out);

    for (const match of html.matchAll(TOKEN)) {
        const [token, closing, rawName] = match;
        if (token.startsWith('<!--')) continue;
        if (!rawName) {
            const text = decodeHtmlText(token);
            // Code inside a link is still the link's text (#96: a code-only link).
            for (const link of links) link.text += text;
            if (code !== undefined) {
                code += text;
                continue;
            }
            out += escapeDiscordMarkdown(text, atLineStart());
            continue;
        }

        const name = rawName.toLowerCase();
        if (name === 'code' || name === 'pre') {
            if (!closing) {
                if (name === 'pre') preDepth += 1;
                if (code === undefined) code = '';
                continue;
            }
            if (name === 'pre') preDepth = Math.max(0, preDepth - 1);
            if (code === undefined) continue;
            if (name === 'code' && preDepth > 0) continue;
            if (name === 'pre') {
                // The block's own blank lines must survive the whitespace cleanup
                // below, so the blank lines around it live outside the placeholder (#96).
                out += '\n\n';
                protect(codeBlock(code));
                out += '\n\n';
            } else {
                protect(inlineCode(code));
            }
            code = undefined;
            continue;
        }
        if (code !== undefined) {
            if (name === 'br') code += '\n';
            continue;
        }

        if (name === 'br') {
            out += '\n';
        } else if (name === 'blockquote') {
            // Reddit quotes become Discord quote lines, like the JSON API's `>` (#96).
            if (!closing) {
                if (!atLineStart()) out += '\n';
                quoteStarts.push(out.length);
                continue;
            }
            const start = quoteStarts.pop();
            if (start === undefined) continue;
            const quoted = out.slice(start)
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n[ \t]+/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            out = out.slice(0, start)
                + (quoted ? quoted.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n') : '')
                + '\n\n';
        } else if (name === 'p' || name === 'ul' || name === 'ol' || name === 'table') {
            if (closing) out += '\n\n';
        } else if (/^h[1-6]$/.test(name)) {
            out += closing ? '\n\n' : `${'#'.repeat(Number(name[1]))} `;
        } else if (name === 'li') {
            out += closing ? '\n' : '- ';
        } else if (name === 'a') {
            if (!closing) {
                links.push({ href: tagAttribute(token, 'href'), start: out.length, text: '' });
                continue;
            }
            const link = links.pop();
            if (!link) continue;
            const inner = out.slice(link.start);
            const before = out.slice(0, link.start);
            const text = link.text.trim();
            const href = absoluteRedditHref(link.href);
            if (!/^https?:\/\//i.test(href)) {
                continue;
            }
            if (!text || /^https?:\/\//i.test(text)) {
                out = before + href;
                continue;
            }
            const label = maskedLinkLabel(inner, restore);
            out = label
                ? `${before}[${label}](${maskedLinkUrl(href)})`
                // Discord would refuse this text as a link label: keep the text and the link.
                : `${before}${inner} (<${href}>)`;
        } else if (['em', 'i', 'strong', 'b', 'del', 's', 'strike', 'span'].includes(name)) {
            if (!closing) {
                const marker = name === 'em' || name === 'i'
                    ? '*'
                    : name === 'strong' || name === 'b'
                        ? '**'
                        : name === 'span'
                            ? (/\bmd-spoiler-text\b/.test(tagAttribute(token, 'class')) ? '||' : '')
                            : '~~';
                openTags.push({ name, closer: marker });
                out += marker;
            } else {
                const index = openTags.map((tag) => tag.name).lastIndexOf(name);
                if (index !== -1) {
                    out += openTags[index].closer;
                    openTags.splice(index, 1);
                }
            }
        }
    }
    if (code) protect(inlineCode(code));

    // Whitespace cleanup runs before code comes back, so code keeps its own.
    const markdown = restore(
        out
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
    );
    // A body of only invisible characters (`&#x200B;`) is no body at all (#96).
    return isInvisibleText(markdown) ? '' : markdown;
}
