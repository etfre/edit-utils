import * as vscode from 'vscode';
import { findAndSelection } from "./core"

export async function handlePing() {
    return {}
}

export async function handleGetActiveDocument(editor: vscode.TextEditor) {
    const { anchor, active } = editor.selection
    const selection = {
        anchor: { line: anchor.line, character: anchor.character },
        active: { line: active.line, character: active.character }
    }
    const lineCount = editor.document.lineCount
    return {
        fileName: editor.document.fileName,
        languageId: editor.document.languageId,
        selection,
        lineCount,
    }
}
export async function handleSelectUntilPattern(editor: vscode.TextEditor, params: SelectUntilPatternRequest['params']) {
    findAndSelection(editor,
        params.pattern,
        params.antiPattern,
        params.count,
        params.reverse,
        params.ignoreCase,
        params.deleteSelection,
        params.isPatternInclude,
        params.isMove,
        false,
    );
}
export async function handleSelectInSurround(editor: vscode.TextEditor, params: SelectInSurroundRequest['params']) {
    // findAndSelection(editor,
    //     params.pattern,
    //     params.antiPattern,
    //     params.count,
    //     params.reverse,
    //     params.ignoreCase,
    //     params.deleteSelection,
    //     params.isPatternInclude,
    //     params.isMove,
    //     false,
    // );
}