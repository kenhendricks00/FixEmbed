import { franc } from 'franc-min';

import {
    chineseScriptName,
    chineseScriptOf,
    chineseTarget,
    convertChineseScript,
    type ChineseTarget,
} from './chinese_script.ts';

import type {
    EmbedData,
    Env,
    HandlerOptions,
    HandlerResponse,
    TranslationMetadata,
} from '../types.ts';

const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';

const LANGUAGE_CODES: Record<string, { code: string; name: string }> = {
    afr: { code: 'af', name: 'Afrikaans' },
    arb: { code: 'ar', name: 'Arabic' },
    ben: { code: 'bn', name: 'Bengali' },
    bos: { code: 'bs', name: 'Bosnian' },
    bul: { code: 'bg', name: 'Bulgarian' },
    cat: { code: 'ca', name: 'Catalan' },
    ces: { code: 'cs', name: 'Czech' },
    cmn: { code: 'zh', name: 'Chinese' },
    cym: { code: 'cy', name: 'Welsh' },
    dan: { code: 'da', name: 'Danish' },
    deu: { code: 'de', name: 'German' },
    ell: { code: 'el', name: 'Greek' },
    eng: { code: 'en', name: 'English' },
    est: { code: 'et', name: 'Estonian' },
    fin: { code: 'fi', name: 'Finnish' },
    fra: { code: 'fr', name: 'French' },
    guj: { code: 'gu', name: 'Gujarati' },
    heb: { code: 'he', name: 'Hebrew' },
    hin: { code: 'hi', name: 'Hindi' },
    hrv: { code: 'hr', name: 'Croatian' },
    hun: { code: 'hu', name: 'Hungarian' },
    ind: { code: 'id', name: 'Indonesian' },
    ita: { code: 'it', name: 'Italian' },
    jpn: { code: 'ja', name: 'Japanese' },
    kan: { code: 'kn', name: 'Kannada' },
    kor: { code: 'ko', name: 'Korean' },
    lav: { code: 'lv', name: 'Latvian' },
    lit: { code: 'lt', name: 'Lithuanian' },
    mal: { code: 'ml', name: 'Malayalam' },
    mar: { code: 'mr', name: 'Marathi' },
    mkd: { code: 'mk', name: 'Macedonian' },
    nld: { code: 'nl', name: 'Dutch' },
    nob: { code: 'no', name: 'Norwegian' },
    pan: { code: 'pa', name: 'Punjabi' },
    pes: { code: 'fa', name: 'Persian' },
    pol: { code: 'pl', name: 'Polish' },
    por: { code: 'pt', name: 'Portuguese' },
    ron: { code: 'ro', name: 'Romanian' },
    rus: { code: 'ru', name: 'Russian' },
    slk: { code: 'sk', name: 'Slovak' },
    slv: { code: 'sl', name: 'Slovenian' },
    spa: { code: 'es', name: 'Spanish' },
    srp: { code: 'sr', name: 'Serbian' },
    swe: { code: 'sv', name: 'Swedish' },
    tam: { code: 'ta', name: 'Tamil' },
    tel: { code: 'te', name: 'Telugu' },
    tha: { code: 'th', name: 'Thai' },
    tur: { code: 'tr', name: 'Turkish' },
    ukr: { code: 'uk', name: 'Ukrainian' },
    urd: { code: 'ur', name: 'Urdu' },
    vie: { code: 'vi', name: 'Vietnamese' },
};

const LANGUAGE_NAMES = new Map(
    Object.values(LANGUAGE_CODES).map(({ code, name }) => [code, name]),
);

export function languageName(language: string): string {
    const normalized = normalizeLanguage(language);
    return normalized
        ? LANGUAGE_NAMES.get(normalized) || normalized.toUpperCase()
        : 'Unknown';
}

/**
 * Two-letter language code, or undefined. Region and script subtags are
 * dropped so `en`, `EN`, `en-US`, and `en_GB` all compare as `en` (#88).
 */
export function normalizeLanguage(value: unknown): string | undefined {
    const language = String(value || '').trim().toLowerCase();
    const match = language.match(/^([a-z]{2})(?:[-_][a-z0-9]{1,8})*$/);
    return match?.[1];
}

const HINDI_SIGNALS = new Set([
    'और',
    'का',
    'की',
    'के',
    'खाने',
    'नहीं',
    'मुझे',
    'मेरा',
    'मेरी',
    'मेरे',
    'यह',
    'ये',
    'रहा',
    'रही',
    'रहे',
    'वह',
    'है',
    'हैं',
]);

const MARATHI_SIGNALS = new Set([
    'आहे',
    'आहेत',
    'आहेस',
    'आणि',
    'केला',
    'केली',
    'तुमचा',
    'तुमची',
    'तुमचे',
    'नाही',
    'मला',
    'माझा',
    'माझी',
    'माझे',
    'होत',
]);

function devanagariLanguage(text: string): { code: string; name: string } | undefined {
    const words = text.normalize('NFC').match(/[\p{Script=Devanagari}\p{Mark}]+/gu) || [];
    if (words.length < 2) return undefined;

    const hindiScore = words.filter((word) => HINDI_SIGNALS.has(word)).length;
    const marathiScore = words.filter((word) => MARATHI_SIGNALS.has(word)).length;
    if (hindiScore >= 2 && hindiScore > marathiScore) {
        return { code: 'hi', name: 'Hindi' };
    }
    return undefined;
}

function detectedLanguage(text: string): { code: string; name: string } | undefined {
    const scriptLanguage = devanagariLanguage(text);
    if (scriptLanguage) return scriptLanguage;
    return LANGUAGE_CODES[franc(text, { minLength: 3 })];
}

function sourceLanguage(data: EmbedData, text: string): { code: string; name: string } | undefined {
    const explicit = normalizeLanguage(data.sourceLanguage);
    if (explicit) {
        return {
            code: explicit,
            name: languageName(explicit),
        };
    }
    return detectedLanguage(text);
}

type TranslationTarget = {
    field: 'caption' | 'description' | 'section' | 'title';
    text: string;
    prefix?: string;
    sectionIndex?: number;
};

type TranslationJob = {
    source: { code: string; name: string };
    target: TranslationTarget;
};

const MULTI_FIELD_PLATFORMS = new Set([
    'reddit',
    'pixiv',
    'bilibili',
    'pinterest',
    'deviantart',
]);

function titleTarget(data: EmbedData): TranslationTarget | undefined {
    const title = String(data.title || '').trim();
    if (!title) return undefined;
    if (data.platform === 'reddit') {
        const match = title.match(/^(r\/[^•]+ • )(.*)$/);
        if (match?.[2]?.trim()) {
            return {
                field: 'title',
                prefix: match[1],
                text: match[2].trim(),
            };
        }
    }
    return { field: 'title', text: title };
}

function translatableTargets(data: EmbedData): TranslationTarget[] {
    if (data.platform === 'twitch') {
        const target = titleTarget(data);
        return target ? [target] : [];
    }

    const caption = String(data.caption || '').trim();
    if (caption) return [{ field: 'caption', text: caption }];

    const description = String(data.description || '').trim();
    if (data.platform === 'youtube') {
        if (data.title.trim().toLowerCase() === 'community post') {
            return description ? [{ field: 'description', text: description }] : [];
        }
        const target = titleTarget(data);
        return target ? [target] : [];
    }

    const title = titleTarget(data);
    if (MULTI_FIELD_PLATFORMS.has(data.platform)) {
        return [
            ...(title ? [title] : []),
            ...(description ? [{ field: 'description' as const, text: description }] : []),
        ];
    }
    if (description) return [{ field: 'description', text: description }];
    return title ? [title] : [];
}

/**
 * Section bodies FixEmbed writes itself. Reddit comment cards carry the parent
 * post as a quote section whose body is this label; it is not the author's
 * text, and language detection reads "Parent post" as French (#88).
 */
const GENERATED_QUOTE_LABELS: Partial<Record<EmbedData['platform'], ReadonlySet<string>>> = {
    reddit: new Set(['parent post']),
};

function translatableQuoteTargets(data: EmbedData): TranslationTarget[] {
    const generatedLabels = GENERATED_QUOTE_LABELS[data.platform];
    return (data.sections || []).flatMap((section, sectionIndex) => {
        const body = String(section.body || '').trim();
        if (section.kind !== 'quote' || !body) return [];
        if (generatedLabels?.has(body.toLowerCase())) return [];
        return [{ field: 'section', sectionIndex, text: body }];
    });
}

function translatedData(
    data: EmbedData,
    translations: Array<{ target: TranslationTarget; text: string }>,
    metadata: TranslationMetadata,
): EmbedData {
    const translated = {
        ...data,
        sections: data.sections?.map((section) => ({ ...section })),
    };
    for (const { target, text } of translations) {
        if (target.field === 'title') {
            translated.title = `${target.prefix || ''}${text}`;
        } else if (target.field === 'description') {
            translated.description = text;
        } else if (target.field === 'caption') {
            translated.description = text;
            translated.caption = text;
        } else if (
            target.sectionIndex !== undefined
            && translated.sections?.[target.sectionIndex]
        ) {
            translated.sections[target.sectionIndex].body = text;
        }
    }
    return {
        ...translated,
        translation: metadata,
    };
}

const DEVANAGARI_PROSE = /\p{Script=Devanagari}[\p{Script=Devanagari}\p{Mark}]*(?:\p{Zs}+\p{Script=Devanagari}[\p{Script=Devanagari}\p{Mark}]*)*/gu;
const PROTECTED_CONTEXT = /(?:https?:\/\/|www\.)\S+|[#@][\p{L}\p{N}\p{M}_]+/giu;

function protectedContextRanges(text: string): Array<{ start: number; end: number }> {
    return Array.from(text.matchAll(PROTECTED_CONTEXT)).map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}

/** Same words, ignoring case, spacing, and punctuation: nothing was translated. */
function sameText(left: string, right: string): boolean {
    const comparable = (value: string) => value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\p{P}]+/gu, '');
    return comparable(left) === comparable(right);
}

async function translatedText(
    env: Env,
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
): Promise<string | undefined> {
    const translation = await env.AI!.run(TRANSLATION_MODEL, {
        text,
        source_lang: sourceLanguage,
        target_lang: targetLanguage,
    }) as { translated_text?: string };
    const translated = translation.translated_text?.trim();
    if (!translated) throw new Error('Empty translation');
    // The model echoed the text back (e.g. "Parent post" -> "Parent Post"):
    // keep the original and do not claim a translation for it (#88).
    if (sameText(translated, text)) return undefined;
    return translated;
}

async function translatePreservingContext(
    env: Env,
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
): Promise<string | undefined> {
    if (sourceLanguage !== 'hi') {
        return translatedText(env, text, sourceLanguage, targetLanguage);
    }

    const maskedText = protectedContextRanges(text).reduceRight(
        (value, range) => (
            value.slice(0, range.start)
            + '\0'.repeat(range.end - range.start)
            + value.slice(range.end)
        ),
        text,
    );
    const matches = Array.from(maskedText.matchAll(DEVANAGARI_PROSE));
    if (!matches.length) {
        return undefined;
    }

    const replacements = await Promise.all(matches.map((match) => (
        translatedText(env, match[0], sourceLanguage, targetLanguage)
    )));
    if (replacements.every((replacement) => replacement === undefined)) {
        return undefined;
    }
    let translated = '';
    let cursor = 0;
    matches.forEach((match, index) => {
        translated += text.slice(cursor, match.index);
        translated += replacements[index] ?? match[0];
        cursor = match.index + match[0].length;
    });
    return translated + text.slice(cursor);
}

/**
 * Chinese in the other script still needs work for a Chinese target: m2m100
 * only knows `zh`, so `zh-TW` would otherwise get a Simplified post untouched
 * (#97). Converting between scripts counts as a translation.
 */
function needsTranslation(
    source: { code: string },
    text: string,
    targetLanguage: string,
    chinese: ChineseTarget | undefined,
): boolean {
    if (source.code !== targetLanguage) return true;
    if (!chinese || source.code !== 'zh') return false;
    const script = chineseScriptOf(text);
    return script !== undefined && script !== chinese.script;
}

async function translateForTarget(
    env: Env,
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    chinese: ChineseTarget | undefined,
): Promise<string | undefined> {
    if (chinese && sourceLanguage === 'zh') {
        const converted = convertChineseScript(text, chinese);
        return converted === text ? undefined : converted;
    }
    const translated = await translatePreservingContext(env, text, sourceLanguage, targetLanguage);
    // m2m100 writes Simplified; a Traditional target gets converted output.
    return translated && chinese ? convertChineseScript(translated, chinese) : translated;
}

/** `zh-TW`, `zh-HK` or `zh-Hant` for a Traditional target; the base code otherwise. */
function targetLanguageTag(targetLanguage: string, chinese: ChineseTarget | undefined): string {
    if (!chinese || chinese.script === 'Hans') return targetLanguage;
    return chinese.region ? `zh-${chinese.region}` : 'zh-Hant';
}

/** Same language, and for Chinese the same script too. */
function isSameLanguage(source: string, target: string): boolean {
    const sourceCode = normalizeLanguage(source);
    if (!sourceCode || sourceCode !== normalizeLanguage(target)) return false;
    return sourceCode !== 'zh' || chineseTarget(source)?.script === chineseTarget(target)?.script;
}

export async function applyRequestedTranslation(
    result: HandlerResponse,
    env: Env,
    options: HandlerOptions,
): Promise<HandlerResponse> {
    const targetLanguage = normalizeLanguage(options.language);
    const chinese = targetLanguage === 'zh' ? chineseTarget(options.language) : undefined;
    const data = result.data;
    if (!targetLanguage || !result.success || !data || !env.AI) {
        return result;
    }
    if (data.platform === 'twitter') {
        return result;
    }
    if (
        data.translation
        && normalizeLanguage(data.translation.targetLanguage) !== targetLanguage
    ) {
        return result;
    }

    const primaryTargets = data.translation ? [] : translatableTargets(data);
    const quoteTargets = translatableQuoteTargets(data);
    if (!primaryTargets.length && !quoteTargets.length) return result;

    const primarySource = primaryTargets.length
        ? sourceLanguage(
            data,
            primaryTargets.map((target) => target.text).join('\n\n'),
        )
        : undefined;
    const existingSource = data.translation
        ? {
            code: data.translation.sourceLanguage,
            name: data.translation.sourceLanguageName,
        }
        : undefined;
    const jobs: TranslationJob[] = [];
    for (const target of primaryTargets) {
        if (primarySource && needsTranslation(primarySource, target.text, targetLanguage, chinese)) {
            jobs.push({ source: primarySource, target });
        }
    }
    for (const target of quoteTargets) {
        const source = detectedLanguage(target.text) || primarySource || existingSource;
        if (source && needsTranslation(source, target.text, targetLanguage, chinese)) {
            jobs.push({ source, target });
        }
    }
    if (!jobs.length) return result;

    try {
        const translatedTargets = (await Promise.all(jobs.map(async ({ source, target }) => {
            const text = await translateForTarget(
                env,
                target.text,
                source.code,
                targetLanguage,
                chinese,
            );
            // A script conversion names the script it came from (#97).
            const script = chinese && source.code === 'zh' ? chineseScriptOf(target.text) : undefined;
            const named = script
                ? { code: `zh-${script}`, name: chineseScriptName(script) }
                : source;
            return text ? { source: named, target, text } : undefined;
        }))).filter(
            (translation): translation is TranslationJob & { text: string } => (
                translation !== undefined
            ),
        );
        if (!translatedTargets.length) return result;

        // Name the language that was actually translated. The primary text's
        // language only counts when the primary text itself was translated;
        // otherwise an English post with a translated quote said "from English" (#88).
        const metadataSource = translatedTargets.find(
            ({ target }) => primaryTargets.includes(target),
        )?.source || translatedTargets[0].source;
        const metadata = data.translation || {
            sourceLanguage: metadataSource.code,
            sourceLanguageName: metadataSource.name,
            targetLanguage: targetLanguageTag(targetLanguage, chinese),
            originalUrl: data.url,
        };
        if (isSameLanguage(metadata.sourceLanguage, metadata.targetLanguage)) return result;

        return {
            ...result,
            data: translatedData(data, translatedTargets, metadata),
        };
    } catch (error) {
        console.error('post_translation_failed', {
            platform: data.platform,
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return result;
    }
}
