import * as vscode from 'vscode';
import { findAndSelection, getPatternRange } from "./textSearch"
import * as ast from "./ast"
import * as dsl from "./parser"
import { assert, mergeGenerators } from './util';
import { performance } from 'perf_hooks';
import { ExecuteCommandRequest, GoToLineRequest, SearchContext, SelectInSurroundRequest, SelectNodeRequest, SelectUntilPatternRequest, SmartActionParams, Target, TreeNode } from './types';
import { findNode } from './nodeSearch';


export async function handlePing() {
    return {}
}

export function handleSmartAction(editor: vscode.TextEditor, params: SmartActionParams) {
    const searchContext = createSearchContext(editor, params.target, params.direction);
    const newSelectionsOrRanges: (vscode.Selection | vscode.Range)[] = [];
    const action = params.action;
    const side = params.target.side ?? null;
    for (const selection of editor.selections) {
        const targets = findTargets(editor, selection, searchContext);
        if (targets === null) {
            continue;
        }
        for (const target of targets) {
            if (action === "select") {
                newSelectionsOrRanges.push(target)
            }
            else if (action === "move") {
                assert(side !== null);
                const newPos = target[side];
                newSelectionsOrRanges.push(new vscode.Selection(newPos, newPos))
            }
            else if (action === "extend") {
                if (selection.active.isBefore(selection.anchor) && target.start.isBefore(selection.active)) {
                    newSelectionsOrRanges.push(new vscode.Selection(selection.anchor, target.start))
                }
                else {
                    const merged = selection.union(target)
                    newSelectionsOrRanges.push(merged)
                }
            }
            else {
                throw new Error(`unrecognized action`)
            }
        }
    }
    const newSelections = newSelectionsOrRanges.map(x => {
        if (!('anchor' in x)) {
            return new vscode.Selection(x.start, x.end);
        }
        return x;
    })
    editor.selections = newSelections;
}

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

function createSearchContext(editor: vscode.TextEditor, target: Target, direction: "backwards" | "forwards" | "smart"): SearchContext {
    const count = target.count ?? 1;
    const side = target.side ?? null;
    if ('selector' in target) {
        const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
        const root = tree.rootNode
        ast.dump(root);
        const selector = dsl.parseInput(target.selector);
        const getEvery = target.getEvery ?? false;
        return {
            type: "nodeSearchContext",
            count,
            root,
            direction,
            selector,
            side,
            getEvery
        }
    }
    else {
        const pattern = target.pattern;
        const antiPattern = target.antiPattern ?? "";
        assert(direction !== "smart")
        return { type: "textSearchContext", direction, count, pattern, antiPattern, side, ignoreCase: true }
    }
}

function getSource(selection: vscode.Selection, direction: "backwards" | "forwards" | "smart") {
    if (direction === "backwards") {
        return selection.start;
    }
    else if (direction === "forwards") {
        return selection.end;
    }
    else {
        return selection.active;
    }
}

function findTargets(editor: vscode.TextEditor, sourceSelection: vscode.Selection, searchContext: SearchContext) {
    const source = getSource(sourceSelection, searchContext.direction);
    if (searchContext.type === "nodeSearchContext") {
        return findNode(sourceSelection, source, searchContext);
    }
    else if (searchContext.type === "textSearchContext") {
        const reverse = searchContext.direction === "backwards"
        const fileText = getTextRange(editor, reverse, source)
        const result = getPatternRange(source, searchContext, fileText)
        if (result !== null) {
            return [result];
        }
    }
    return null;
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
    ast.dump(root);
    const selector = dsl.parseInput(params.pattern);
    const direction = params.direction as any;
    let newSelections: vscode.Selection[] = [];
    for (const selection of editor.selections) {
        const cursorPosition = selection.active;
        const path = ast.findNodePathToPosition(cursorPosition, root)
        if (path === null) {
            continue;
        }
        const leaf = path.getLeaf();
        let pathNodeGeneratorFn: Generator<ast.PathNode>;
        if (direction === "smart") {
            pathNodeGeneratorFn = mergeGenerators(leaf.iterUp(), ast.iterClosest(cursorPosition, leaf));
        }
        else if (direction === "backwards") {
            pathNodeGeneratorFn = ast.iterDirection("backwards", leaf, true);
        }
        else if (direction === "forwards") {
            pathNodeGeneratorFn = ast.iterDirection("forwards", leaf, true);
        }
        else {
            throw new Error("")
        }
        for (const matches of ast.search(pathNodeGeneratorFn, selector)) {
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

function filterMatch(testNode: TreeNode, selection: vscode.Selection, direction: "before" | "after" | "smart"): boolean {
    if (direction === "before") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isBefore(selection.anchor);
    }
    else if (direction === "after") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isAfter(selection.active);
    }
    return true;
}