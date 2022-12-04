import * as vscode from 'vscode';
import { findAndSelection } from "./core"
import * as ast from "./ast"
import * as dsl from "./dsl"


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
    const isPatternInclude = params.isPatternInclude
    const selections = findAndSelection(editor, params.left, params.right, 1, true, true, false, isPatternInclude, false, true)
    editor.document.languageId
    if (selections.length > 0) {
        findAndSelection(editor, params.right, params.left, 1, false, true, isPatternInclude, false, false)
    }
}

export async function handleSelectNode(editor: vscode.TextEditor, params: SelectNodeRequest['params']) {
    const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
    const root = tree.rootNode
    ast.dump(root)
    const rootSelector = dsl.parseInput(params.pattern)
    const cursorPosition = editor.selection.anchor;
    const nodeToSelect = ast.searchFromPosition(cursorPosition, root, params.direction, params.type, rootSelector)
    if (nodeToSelect !== null) {
        const selection = ast.selectionFromTreeNode(nodeToSelect, false)
        editor.selections = [selection]
    }
}