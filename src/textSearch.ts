import * as vscode from 'vscode';
import { TextSearchContext } from './types';

const parseTreeExtension: vscode.Extension<any> = vscode.extensions.getExtension("pokey.parse-tree") as any;

const antiPatternMap = {
    "{": "}",
    "}": "{",
    "(": ")",
    ")": "(",
    "[": "]",
    "]": "[",
} as const

function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export const BACKWARDS_SURROUND_CHARS = ['"""', '"', "'''", "'", '`', "{", "(", "["].map(x => escapeRegExp(x)).join('|');
export const FORWARDS_SURROUND_CHARS = ['"""', '"', "'''", "'", '`', "}", ")", "]"].map(x => escapeRegExp(x)).join('|');
export const BACKWARDS_ANTIPATTERN = ["}", ")", "]"].map(x => escapeRegExp(x)).join('|');
export const FORWARDS_ANTIPATTERN = ["{", "(", "["].map(x => escapeRegExp(x)).join('|');
console.log(BACKWARDS_SURROUND_CHARS)

function matchAll(pattern: string, test: string, flags: string = "") {
    if (!flags.includes("g")) {
        flags += "g";
    }
    if (!flags.includes("d")) {
        flags += "d";
    }
    const regex = new RegExp(pattern, flags);
    const matches = []
    while (true) {
        const match = regex.exec(test);
        if (match != null) {
            matches.push(match)
        }
        else {
            return matches;
        }
    }
}

/**
 * Get the position of the pattern in the editor
 */
export function getPatternRange(
    fromPos: vscode.Position,
    searchContext: TextSearchContext,
    fileText: string,
): vscode.Range | null {
    const reverse = searchContext.direction === "backwards";
    let flags = '';
    if (searchContext.ignoreCase) {
        flags += "i"
    }
    let lines = fileText.split('\n');
    if (reverse) {
        lines = lines.reverse();
    }
    const result = getLastMatch(lines, searchContext.pattern, flags, searchContext.count, reverse);
    if (result === null) return null;
    const { match, lineNumber } = result;
    const endPosLine = reverse ? (fromPos.line - lineNumber) : (fromPos.line + lineNumber);
    let index = match.index;
    if (!reverse && endPosLine === fromPos.line) { // pattern in same line as cursor line
        index += fromPos.character;
    }
    const matchText = match[1]
    const endOfPatternIndex = index + matchText.length;
    const start = new vscode.Position(endPosLine, index)
    const end = new vscode.Position(endPosLine, endOfPatternIndex)
    return new vscode.Range(start, end);
}

function getLastMatch(lines: string[], pattern: string, flags: string, repeatNumber: number, reverse: boolean) {
    let matchCounts = new Map<string, number>()
    const antiPattern = reverse ? BACKWARDS_ANTIPATTERN : FORWARDS_ANTIPATTERN
    // if antiPattern, merge into one regex then check what we get
    const bothPatterns = `(${pattern})|(${antiPattern})`;
    for (const [lineNumber, line] of lines.entries()) {
        const lineMatches = matchAll(bothPatterns, line, flags)
        if (reverse) {
            lineMatches.reverse()
        }
        for (const match of lineMatches) {
            // found antipattern
            const antiPatternMatch = match[2]
            if (antiPatternMatch) {
                if (antiPatternMatch in antiPatternMap) {
                    //@ts-ignore
                    const matchPattern = antiPatternMap[antiPatternMatch]
                    if (!matchCounts.has(matchPattern)) {
                        matchCounts.set(matchPattern, 0)
                    }
                    matchCounts.set(matchPattern, matchCounts.get(matchPattern) as number - 1)
                }
            }
            else {
                const patternMatch = match[1];
                if (!matchCounts.has(patternMatch)) {
                    matchCounts.set(patternMatch, 0)
                }
                matchCounts.set(patternMatch, matchCounts.get(patternMatch) as number + 1)
                if (matchCounts.get(patternMatch) as number >= repeatNumber) {
                    return { match, lineNumber }
                }
            }
        }
    }
    return null;
}
