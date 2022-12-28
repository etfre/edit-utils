import * as vscode from 'vscode';
import { findAndSelection } from "./core"
import * as ast from "./ast"
import * as dsl from "./parser"
import { mergeGenerators } from './util';
import { performance } from 'perf_hooks';


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

export async function handleGoToLine(editor: vscode.TextEditor, params: GoToLineRequest['params']) {
    const line = params.line;
    editor.selection = new vscode.Selection(line, 0, line, 0);
    await vscode.commands.executeCommand("cursorHome")
}

export async function handleExecuteCommand(editor: vscode.TextEditor, params: ExecuteCommandRequest['params']) {
    const args = params.args ?? [];
    await vscode.commands.executeCommand(params.command, ...args)
}

export async function handleSelectNode(editor: vscode.TextEditor, params: SelectNodeRequest['params']) {
    const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
    const root = tree.rootNode
    const selectors = params.patterns.map(dsl.parseInput);
    const direction = params.direction;
    let newSelections: vscode.Selection[] = [];
    for (const selection of editor.selections) {
        const cursorPosition = selection.active;
        const s = performance.now();
        const path = ast.findNodePathToPosition(cursorPosition, root)
        const e = performance.now();
        console.log(e-s)
        if (path === null) {
            continue;
        }
        const leaf = path.getLeaf();
        let pathNodeGeneratorFn: Generator<ast.PathNode>;
        if (direction === "up") {
            pathNodeGeneratorFn = mergeGenerators(leaf.iterUp(), ast.iterClosest(cursorPosition, leaf));
        }
        else if (direction === "before") {
            pathNodeGeneratorFn = ast.iterDirection("before", leaf, true);
        }
        else if (direction === "after") {
            pathNodeGeneratorFn = ast.iterDirection("after", leaf);
        }
        else {
            throw new Error("")
        }
        for (const matches of ast.search(pathNodeGeneratorFn, selectors)) {
            const filteredMatches = matches.filter(x => filterMatch(x, selection, direction));
            if (filteredMatches.length > 0) {
                if (params.selectType === "block") {
                    const mergedSelection = ast.selectionFromNodeArray(filteredMatches, false);
                    newSelections.push(mergedSelection)
                }
                else if (params.selectType === "each") {
                    const mergedSelections = filteredMatches.map(x => ast.selectionFromNodeArray([x], false));
                    newSelections = newSelections.concat(mergedSelections)
                }
                else {
                    throw new Error(`Unhandled selectAction ${params.selectType}`)
                }
                break;
            }
        }
    }
    if (newSelections.length > 0) {
        editor.selections = newSelections;
    }
}

function filterMatch(testNode: TreeNode, selection: vscode.Selection, direction: "before" | "after" | "up"): boolean {
    if (direction === "before") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isBefore(selection.anchor);
    }
    else if (direction === "after") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isAfter(selection.active);
    }
    return true;
}