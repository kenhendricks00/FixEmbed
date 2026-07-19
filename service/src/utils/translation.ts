import { franc } from 'franc-min';

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

function normalizeLanguage(value: unknown): string | undefined {
    const language = String(value || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(language) ? language : undefined;
}

function sourceLanguage(data: EmbedData, text: string): { code: string; name: string } | undefined {
    const explicit = normalizeLanguage(data.sourceLanguage);
    if (explicit) {
        return {
            code: explicit,
            name: languageName(explicit),
        };
    }
    return LANGUAGE_CODES[franc(text, { minLength: 3 })];
}

type TranslationTarget = {
    field: 'caption' | 'description' | 'title';
    text: string;
    prefix?: string;
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

function translatedData(
    data: EmbedData,
    translations: Array<{ target: TranslationTarget; text: string }>,
    metadata: TranslationMetadata,
): EmbedData {
    const translated = { ...data };
    for (const { target, text } of translations) {
        if (target.field === 'title') {
            translated.title = `${target.prefix || ''}${text}`;
        } else if (target.field === 'description') {
            translated.description = text;
        } else {
            translated.description = text;
            translated.caption = text;
        }
    }
    return {
        ...translated,
        translation: metadata,
    };
}

export async function applyRequestedTranslation(
    result: HandlerResponse,
    env: Env,
    options: HandlerOptions,
): Promise<HandlerResponse> {
    const targetLanguage = normalizeLanguage(options.language);
    const data = result.data;
    if (!targetLanguage || !result.success || !data || data.translation || !env.AI) {
        return result;
    }

    const targets = translatableTargets(data);
    if (!targets.length) return result;

    const source = sourceLanguage(
        data,
        targets.map((target) => target.text).join('\n\n'),
    );
    if (!source || source.code === targetLanguage) return result;

    try {
        const translatedTargets = await Promise.all(targets.map(async (target) => {
            const translation = await env.AI!.run(TRANSLATION_MODEL, {
                text: target.text,
                source_lang: source.code,
                target_lang: targetLanguage,
            }) as { translated_text?: string };
            const text = translation.translated_text?.trim();
            if (!text || text === target.text) throw new Error('Empty translation');
            return { target, text };
        }));

        return {
            ...result,
            data: translatedData(data, translatedTargets, {
                sourceLanguage: source.code,
                sourceLanguageName: source.name,
                targetLanguage,
                originalUrl: data.url,
            }),
        };
    } catch (error) {
        console.error('post_translation_failed', {
            platform: data.platform,
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return result;
    }
}
