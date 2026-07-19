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

function translatableText(data: EmbedData): string {
    return String(data.caption || data.description || '').trim();
}

function translatedData(
    data: EmbedData,
    translatedText: string,
    metadata: TranslationMetadata,
): EmbedData {
    return {
        ...data,
        description: translatedText,
        ...(data.caption ? { caption: translatedText } : {}),
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

    const originalText = translatableText(data);
    if (!originalText) return result;

    const source = sourceLanguage(data, originalText);
    if (!source || source.code === targetLanguage) return result;

    try {
        const translation = await env.AI.run(TRANSLATION_MODEL, {
            text: originalText,
            source_lang: source.code,
            target_lang: targetLanguage,
        }) as { translated_text?: string };
        const translatedText = translation.translated_text?.trim();
        if (!translatedText || translatedText === originalText) return result;

        return {
            ...result,
            data: translatedData(data, translatedText, {
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
