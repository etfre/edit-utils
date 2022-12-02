import * as vscode from 'vscode';


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
function getPatternPosition(
    currentCursor: vscode.Position,
    text: string,
    pattern: string,
    antiPattern: string,
    count: number,
    reverse: boolean = false,
    isIgnoreCase: boolean = false,
    isPatternInclude: boolean = false,
) {
    let flags = '';
    if (isIgnoreCase) {
        flags += "i"
    }
    let lines = text.split('\n');
    if (reverse) {
        lines = lines.reverse();
    }
    let endPosLine = 0;
    let endPosIndex = 0;
    const result = getLastMatch(lines, pattern, antiPattern, flags, count, reverse);
    if (result === null) return null;
    const { match, lineNumber } = result;
    const index = match.index;
    const matchText = match[1]
    endPosLine = reverse ? (currentCursor.line - lineNumber) : (currentCursor.line + lineNumber);
    if (reverse) {
        endPosIndex = index;
    } else {
        if (endPosLine == currentCursor.line) { // pattern in same line as cursor line
            endPosIndex = index + currentCursor.character;
        } else {
            endPosIndex = index;
        }
    }
    if (reverse) {
        return new vscode.Position(endPosLine, (isPatternInclude ? endPosIndex : endPosIndex + matchText.length));
    } else {
        return new vscode.Position(endPosLine, (isPatternInclude ? endPosIndex + matchText.length : endPosIndex));
    }
}

function getLastMatch(lines: string[], pattern: string, antiPattern: string, flags: string, repeatNumber: number, reverse: boolean) {
    let count = 0;
    // if antiPattern, merge into one regex then check what we get
    const bothPatterns = antiPattern.length > 0 ? `(${pattern})|(${antiPattern})` : `(${pattern})`
    for (const [lineNumber, line] of lines.entries()) {
        const lineMatches = matchAll(bothPatterns, line, flags)
        if (reverse) {
            lineMatches.reverse()
        }
        for (const match of lineMatches) {
            // found antipattern
            if (match[2]) {
                count--;
            }
            else {
                count++
                if (count >= repeatNumber) {
                    return { match, lineNumber }
                }
            }
        }
    }
    return null;
}

function deleteSelection(editor: vscode.TextEditor, allSelections: vscode.Selection[]) {
    return editor.edit(builder => {
        for (const selection of allSelections) {
            builder.replace(selection, "");
        };
    });
}

function modifyAllSelections(editFn: (builder: vscode.TextEditorEdit, selection: vscode.Selection) => void) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit(builder => {
        for (const selection of editor.selections) {
            editFn(builder, selection);
        }
    })
}

/**
 * Return text from start a begin Position to end position
 */
function getTextRange(editor: vscode.TextEditor, reverse: boolean, startedSelection: vscode.Position) {
    let textRange: vscode.Range;
    if (reverse) {
        const lastLine = editor.document.lineAt(0);
        textRange = new vscode.Range(startedSelection, lastLine.range.start);
    } else {
        const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
        textRange = new vscode.Range(startedSelection, lastLine.range.end);
    }

    return editor.document.getText(textRange);
}

/**
 * Select of the pattern
 */
export function findAndSelection(
    editor: vscode.TextEditor,
    input: string,
    antiPattern: string = '',
    count: number = 1,
    reverse: boolean = false,
    isIgnoreCase: boolean = false,
    isDeleteSelection: boolean = false,
    isPatternInclude: boolean = false,
    isMove: boolean = false,
    swapAnchorAndActive = false
) {
    const allSelections = findSelections(
        editor,
        input,
        antiPattern,
        count,
        reverse,
        isIgnoreCase,
        isPatternInclude,
        isMove,
        swapAnchorAndActive,
    );
    let notFoundRepeat = 0;
    if (notFoundRepeat >= editor.selections.length) {
        vscode.window.showErrorMessage(`Not found : ${input}`);
    } else {
        editor.selections = allSelections;
        if (isDeleteSelection) {
            deleteSelection(editor, allSelections);
        }
    }
    return allSelections;
}

function findSelections(
    editor: vscode.TextEditor,
    input: string,
    antiPattern: string,
    count: number,
    reverse: boolean = false,
    isIgnoreCase: boolean = false,
    isPatternInclude: boolean = false,
    isMove: boolean = false,
    swapAnchorAndActive = false
) {
    let notFoundRepeat = 0;
    const allSelections: vscode.Selection[] = [];
    for (const selection of editor.selections) {
        const currentCursor = selection.active;
        const text = getTextRange(editor, reverse, currentCursor);
        const patternPosition = getPatternPosition(currentCursor, text, input, antiPattern, count, reverse, isIgnoreCase, isPatternInclude);

        if (patternPosition == null) {
            // allSelections.push(selection);
            notFoundRepeat += 1;
        } else {
            const anchor = isMove ? patternPosition : selection.anchor;
            const newSelection = swapAnchorAndActive ? new vscode.Selection(patternPosition, anchor) : new vscode.Selection(anchor, patternPosition)
            allSelections.push(newSelection);
        }
    }
    return allSelections;

}

function parseUserInput(input: string) {

}

/**
 * Manage the regex of the user input
 */


function selectInSurround(editor: vscode.TextEditor, input: string) {
    findAndSelection(editor, "\\(", "\\)", 1, true, true, false, false, false, true)
    findAndSelection(editor, "\\)", "\\(", 1, false, true, false, false, false)
    console.log(input);
}

function analyzeLine(line: string, commentPattern: RegExp | null) {
    let indentationLevel = 0
    for (let char of line) {

    }
}

