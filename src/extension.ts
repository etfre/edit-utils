import * as vscode from 'vscode';
import { read } from 'fs';

let lastQuery = '';
var repeatNumber = 1;

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
    isPatternNotInclude: boolean = false,
) {
    let lines = text.split('\n');
    if (reverse) {
        lines = lines.reverse();
    }
    var endPosLine = 0;
    var endPosIndex = 0;
    var includeInSelectionConfig = false;

    if (isPatternInclude) {
        includeInSelectionConfig = true;
    }
    else if (isPatternNotInclude) {
        includeInSelectionConfig = false;
    } else {
        includeInSelectionConfig = vscode.workspace.getConfiguration('select-until-pattern').includePatternInSelection;
    }
    const result = getLastMatch(lines, pattern, "", repeatNumber)
    if (result === null) return null;
    const { match, lineNumber } = result;
    var index = match.index;
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
        return new vscode.Position(endPosLine, (includeInSelectionConfig ? endPosIndex : endPosIndex + matchText.length));
    } else {
        return new vscode.Position(endPosLine, (includeInSelectionConfig ? endPosIndex + matchText.length : endPosIndex));
    }
}

function getLastMatch(lines: string[], pattern: string, flags: string, repeatNumber: number) {
    let count = 0;
    for (var lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        for (let match of matchAll(pattern, lines[lineNumber], flags)) {
            count++;
            if (count >= repeatNumber) {
                return { match, lineNumber };
            }
        }
    }
    return null;
}

function deleteSelection(editor: vscode.TextEditor, allSelections: vscode.Selection[]) {
    editor.edit(builder => {
        allSelections.forEach(selection => {
            builder.replace(selection, "");
        });
    });
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
    isPatternNotInclude: boolean = false
) {
    var allSelections: vscode.Selection[] = [];
    var notFoundRepeat = 0;
    for (const selection of editor.selections) {
        var currentCursor = selection.active;
        var text = getTextRange(editor, reverse, currentCursor);
        var patternPosition = getPatternPosition(currentCursor, text, input, reverse, isIgnoreCase, isPatternInclude, isPatternNotInclude);

        if (patternPosition == null) {
            notFoundRepeat += 1;
        } else {
            allSelections.push(new vscode.Selection(selection.anchor, patternPosition));
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
    var regex = input.match(/^(.*)\/+(.*)$/) || [""];
    var pattern = regex[1];
    var flag = regex[2];
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

    var reverse = flag.includes("r");
    var ignoreCase = flag.includes("i");
    var isPatternInclude = flag.includes("c");
    var isPatternNotInclude = flag.includes("e");
    var isDeleteSelection = flag.includes("d");
    var findNumber = flag.match(/\d+/);

    if (findNumber) {
        repeatNumber = parseInt(findNumber[0], 10);
    }

    findAndSelection(editor, pattern, reverse, ignoreCase, isDeleteSelection, isPatternInclude, isPatternNotInclude);
}


/**
 * Manage the pattern section
 */
async function handleSelection(editor: vscode.TextEditor) {
    var input = await getKeywordFromUser();
    var saveLastPattern = vscode.workspace.getConfiguration('select-until-pattern').saveLastPattern;
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


export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.select-until-pattern', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage(`Not Editor is opened`);
            return;
        }
        handleSelection(editor);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
