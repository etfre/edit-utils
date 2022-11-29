import * as vscode from 'vscode';
import { watchFile, watch, writeFile, readFile, FSWatcher } from 'fs';
import { tmpdir } from 'os';
import * as handlers from "./handlers"
import { sep } from 'path';
import { shutdown, watchRPCInputFile } from "./rpc"
import * as core from "./core"

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
    isMove: boolean = false,
    swapAnchorAndActive = false
) {
    const allSelections = findSelections(editor,
        input,
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
}

function findSelections(
    editor: vscode.TextEditor,
    input: string,
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
        const patternPosition = getPatternPosition(currentCursor, text, input, reverse, isIgnoreCase, isPatternInclude);

        if (patternPosition == null) {
            allSelections.push(selection);
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

function selectInSurround(editor: vscode.TextEditor, input: string) {
    core.findAndSelection(editor, "\\(", "\\)" ,1, true, true, false, false, false, true)
    core.findAndSelection(editor, "\\)", "\\(", 1, false, true, false, false, false)
    console.log(input);
}

function registerEditorCommand(name: string, context: vscode.ExtensionContext, command: (editor: vscode.TextEditor, cmd: string) => void) {
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
            command(editor, input);
        }
    });
    context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
    registerEditorCommand("select-until-pattern", context, handleRegex);
    registerEditorCommand("select-in-surround", context, selectInSurround);
    watchRPCInputFile()
    // setInterval(() => watchRPCInputFile(RPC_INPUT_FILE, (x: string) => { }), 1000)
    // disposables.push(watcher.close)
}

export async function deactivate() {
    shutdown()

}
