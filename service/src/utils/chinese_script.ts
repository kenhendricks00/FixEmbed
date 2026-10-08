/**
 * Simplified/Traditional Chinese conversion for translations (#97).
 *
 * Workers AI's m2m100 knows only `zh` and always writes Simplified Chinese, so
 * a Traditional target (`zh-TW`, `zh-HK`, `zh-Hant`) is reached by converting
 * its output, and a Chinese post in the other script is converted without the
 * model at all. Tables come from OpenCC (see chinese_script_data.ts): phrases
 * by longest match first, then single characters, then the Taiwan or Hong Kong
 * variant forms.
 */

import {
    HK_VARIANTS,
    S2T_CHARACTERS,
    S2T_PHRASES,
    T2S_CHARACTERS,
    T2S_PHRASES,
    TW_VARIANTS,
} from './chinese_script_data.ts';

export type ChineseScript = 'Hans' | 'Hant';
export type ChineseTarget = { script: ChineseScript; region?: 'TW' | 'HK' };

type Converter = {
    characters: ReadonlyMap<string, string>;
    phrases: ReadonlyMap<string, string>;
    phraseStarts: ReadonlySet<string>;
    longestPhrase: number;
};

function converter(
    characters: Readonly<Record<string, string>>,
    phrases: Readonly<Record<string, string>> = {},
): Converter {
    const phraseKeys = Object.keys(phrases);
    return {
        characters: new Map(Object.entries(characters)),
        phrases: new Map(Object.entries(phrases)),
        phraseStarts: new Set(phraseKeys.map((phrase) => Array.from(phrase)[0])),
        longestPhrase: Math.max(1, ...phraseKeys.map((phrase) => Array.from(phrase).length)),
    };
}

let toTraditional: Converter | undefined;
let toSimplified: Converter | undefined;
let taiwan: Converter | undefined;
let hongKong: Converter | undefined;

function convert(text: string, table: Converter): string {
    const chars = Array.from(text);
    let out = '';
    let index = 0;
    while (index < chars.length) {
        let matched = false;
        if (table.phraseStarts.has(chars[index])) {
            for (let length = Math.min(table.longestPhrase, chars.length - index); length > 1; length -= 1) {
                const phrase = table.phrases.get(chars.slice(index, index + length).join(''));
                if (phrase !== undefined) {
                    out += phrase;
                    index += length;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) {
            out += table.characters.get(chars[index]) ?? chars[index];
            index += 1;
        }
    }
    return out;
}

/** The script and region a `zh*` language tag asks for, or undefined for other languages. */
export function chineseTarget(language: unknown): ChineseTarget | undefined {
    const subtags = String(language || '').trim().toLowerCase().split(/[-_]/);
    if (subtags[0] !== 'zh') return undefined;
    const rest = subtags.slice(1);
    const region = rest.includes('tw') ? 'TW' : rest.some((tag) => tag === 'hk' || tag === 'mo') ? 'HK' : undefined;
    if (region || rest.includes('hant')) return region ? { script: 'Hant', region } : { script: 'Hant' };
    return { script: 'Hans' };
}

/** Which script Chinese text is written in, by its script-specific characters. */
export function chineseScriptOf(text: string): ChineseScript | undefined {
    let simplified = 0;
    let traditional = 0;
    for (const char of text) {
        if (Object.prototype.hasOwnProperty.call(S2T_CHARACTERS, char)) simplified += 1;
        else if (Object.prototype.hasOwnProperty.call(T2S_CHARACTERS, char)) traditional += 1;
    }
    if (simplified === traditional) return undefined;
    return traditional > simplified ? 'Hant' : 'Hans';
}

/** Rewrite Chinese text in the target's script and regional variant forms. */
export function convertChineseScript(text: string, target: ChineseTarget): string {
    if (target.script === 'Hans') {
        toSimplified ??= converter(T2S_CHARACTERS, T2S_PHRASES);
        return convert(text, toSimplified);
    }
    toTraditional ??= converter(S2T_CHARACTERS, S2T_PHRASES);
    const traditional = convert(text, toTraditional);
    if (target.region === 'TW') {
        taiwan ??= converter(TW_VARIANTS);
        return convert(traditional, taiwan);
    }
    if (target.region === 'HK') {
        hongKong ??= converter(HK_VARIANTS);
        return convert(traditional, hongKong);
    }
    return traditional;
}

export function chineseScriptName(script: ChineseScript): string {
    return script === 'Hant' ? 'Chinese (Traditional)' : 'Chinese (Simplified)';
}
