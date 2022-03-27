import * as vscode from 'vscode';
import { read } from 'fs';

let lastQuery = '';
var repeatNumber = 1;

type SearchOptions = {
    reverse: boolean,
    isIgnoreCase: boolean,
    isPatternInclude: boolean,
    isPatternNotInclude: boolean,
}

function* matchAll(pattern: string, test: string, flags: string = "") {
    if (!flags.includes("g")) {
        flags += "g";
    }
    const regex = new RegExp(pattern, flags);
    while (true) {
        const match = regex.exec(test);
        if (match != null) {
            yield match;
        }
        else {
            break;
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
    const result = getLastMatch(lines, pattern, flags, repeatNumber, reverse);
    if (result === null) return null;
    const { match, lineNumber } = result;
    const index = match.index;
    const matchText = match[0]
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

function getLastMatch(lines: string[], pattern: string, flags: string, repeatNumber: number, reverse: boolean) {
    let count = 0;
    for (const [lineNumber, line] of lines.entries()) {
        const matches: { match: RegExpExecArray, lineNumber: number }[] = []
        for (const match of matchAll(pattern, line, flags)) {
            matches.push({ match, lineNumber });
            if (count + matches.length >= repeatNumber && !reverse) {
                return { match, lineNumber };
            }
        }
        // if reverse, search forwards but return nth from the end of the line
        if (reverse && count + matches.length >= repeatNumber) {
            return matches[matches.length - repeatNumber];
        }
        count += matches.length;
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
        // var firstLine = editor.document.lineAt(startedSelection.line + 1);
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
function findAndSelection(
    editor: vscode.TextEditor,
    input: string,
    reverse: boolean = false,
    isIgnoreCase: boolean = false,
    isDeleteSelection: boolean = false,
    isPatternInclude: boolean = false,
    isMove: boolean = false
) {
    const allSelections: vscode.Selection[] = [];
    let notFoundRepeat = 0;
    for (const selection of editor.selections) {
        const currentCursor = selection.active;
        const text = getTextRange(editor, reverse, currentCursor);
        const patternPosition = getPatternPosition(currentCursor, text, input, reverse, isIgnoreCase, isPatternInclude);

        if (patternPosition == null) {
            notFoundRepeat += 1;
        } else {
            const anchor = isMove ? patternPosition : selection.anchor;
            allSelections.push(new vscode.Selection(anchor, patternPosition));
        }

    }
    if (notFoundRepeat >= editor.selections.length) {
        vscode.window.showErrorMessage(`Not found : ${input}`);
    } else {
        editor.selections = allSelections;
        if (isDeleteSelection) {
            deleteSelection(editor, allSelections);
        }
    }
}


/**
 * Manage the regex of the user input
 */
function handleRegex(editor: vscode.TextEditor, input: string) {
    const regex = input.match(/^(.*)\/+(.*)$/) || [""];
    let pattern = regex[1];
    const flag = regex[2];
    repeatNumber = 1;

    if (input.slice(input.length - 1) == '/') {
        pattern = pattern.substring(0, pattern.length - 1);
        findAndSelection(editor, pattern);
        return;
    }
    if (!pattern || !flag) {
        findAndSelection(editor, input);
        return;
    }

    const reverse = flag.includes("r");
    const ignoreCase = flag.includes("i");
    const isPatternInclude = flag.includes("c");
    const isDeleteSelection = flag.includes("d");
    const isMove = flag.includes("m")
    const findNumber = flag.match(/\d+/);

    if (findNumber) {
        repeatNumber = parseInt(findNumber[0], 10);
    }

    findAndSelection(editor, pattern, reverse, ignoreCase, isDeleteSelection, isPatternInclude, isMove);
}


/**
 * Manage the pattern section
 */
async function handleSelection(editor: vscode.TextEditor) {
    const input = await getKeywordFromUser();
    const saveLastPattern = vscode.workspace.getConfiguration('select-until-pattern').saveLastPattern;
    if (!input) {
        return;
    }
    if (saveLastPattern) {
        lastQuery = input;
    }
    handleRegex(editor, input);
}


/**
 * Display the user input
 */
function getKeywordFromUser() {
    return vscode.window.showInputBox({
        placeHolder: 'Syntax: "<pattern>/i" "<pattern>/ri"',
        value: lastQuery,
    });
}

function selectInSurround(input: string) {
    console.log(input);
}

function registerEditorCommand(name: string, context: vscode.ExtensionContext, command: (cmd: string) => void) {
    const fullName = `extension.${name}`;
    const disposable = vscode.commands.registerCommand(fullName, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(`Editor is not opened`);
            return;
        }
        const input = await vscode.window.showInputBox({
            placeHolder: 'Syntax: "<pattern>/i" "<pattern>/ri"',
        })
        if (input !== undefined) {
            command(input);
        }
    });
    context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('extension.select-until-pattern', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(`Not Editor is opened`);
            return;
        }
        handleSelection(editor);
    });

    context.subscriptions.push(disposable);
    registerEditorCommand("select-in-surround", context, selectInSurround);
}

export function deactivate() { }
