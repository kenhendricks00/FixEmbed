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

export function normalizeLanguage(value: unknown): string | undefined {
    const language = String(value || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(language) ? language : undefined;
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
    if (marathiScore >= 2 && marathiScore > hindiScore) {
        return { code: 'mr', name: 'Marathi' };
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

function translatableQuoteTargets(data: EmbedData): TranslationTarget[] {
    return (data.sections || []).flatMap((section, sectionIndex) => {
        const body = String(section.body || '').trim();
        if (section.kind !== 'quote' || !body) return [];
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

export async function applyRequestedTranslation(
    result: HandlerResponse,
    env: Env,
    options: HandlerOptions,
): Promise<HandlerResponse> {
    const targetLanguage = normalizeLanguage(options.language);
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
    if (primarySource?.code !== targetLanguage) {
        for (const target of primaryTargets) {
            if (primarySource) jobs.push({ source: primarySource, target });
        }
    }
    for (const target of quoteTargets) {
        const source = detectedLanguage(target.text) || primarySource || existingSource;
        if (source && source.code !== targetLanguage) {
            jobs.push({ source, target });
        }
    }
    if (!jobs.length) return result;

    try {
        const translatedTargets = await Promise.all(jobs.map(async ({ source, target }) => {
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
            data: translatedData(
                data,
                translatedTargets,
                data.translation || {
                    sourceLanguage: (primarySource || jobs[0].source).code,
                    sourceLanguageName: (primarySource || jobs[0].source).name,
                    targetLanguage,
                    originalUrl: data.url,
                },
            ),
        };
    } catch (error) {
        console.error('post_translation_failed', {
            platform: data.platform,
            errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return result;
    }
}
