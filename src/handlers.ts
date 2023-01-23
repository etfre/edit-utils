import * as vscode from 'vscode';
import { getPatternRange } from "./textSearch"
import * as ast from "./ast"
import * as dsl from "./parser"
import { assert, mergeGenerators } from './util';
import { ExecuteCommandRequest, GoToLineRequest, OnDone, SearchContext, SelectInSurroundRequest, SmartActionParams, SurroundSearchContext, Target, TreeNode } from './types';
import { findNode } from './nodeSearch';


export async function handlePing() {
    return {}
}

export function handleSmartAction(editor: vscode.TextEditor, params: SmartActionParams) {
    const searchContext = createSearchContext(editor, params.target, params.direction);
    const side = params.target.side ?? null;
    const onDone = params.onDone ?? null;
    doThing2(params.action, editor, searchContext, side, onDone);
}

function doThing2(
    action: "move" | "select" | "extend",
    editor: vscode.TextEditor,
    searchContext: SearchContext,
    side: "start" | "end" | null,
    onDone: OnDone | null
) {
    const newSelectionsOrRanges: (vscode.Selection | vscode.Range)[] = [];
    for (const selection of editor.selections) {
        const targets = findTargets(editor, selection, searchContext);
        if (targets === null) {
            continue;
        }
        for (const target of targets) {
            if (action === "select") {
                newSelectionsOrRanges.push(target);
            }
            else if (action === "move") {
                assert(side !== null);
                const newPos = target[side];
                newSelectionsOrRanges.push(new vscode.Selection(newPos, newPos));
            }
            else if (action === "extend") {
                const newTarget = side === null ? target : new vscode.Range(target[side], target[side]); 
                if (selection.active.isBefore(selection.anchor) && newTarget.start.isBefore(selection.active)) {
                    newSelectionsOrRanges.push(new vscode.Selection(selection.anchor, newTarget.start));
                }
                else {
                    const merged = selection.union(newTarget);
                    newSelectionsOrRanges.push(merged);
                }
            }
            else {
                throw new Error(`unrecognized action`);
            }
        }
    }
    const newSelections = newSelectionsOrRanges.map(x => {
        if (!('anchor' in x)) {
            return new vscode.Selection(x.start, x.end);
        }
        return x;
    });
    if (onDone === null || true) {
        editor.selections = newSelections;
    }
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
        assert(direction !== "smart")
        return { type: "textSearchContext", direction, count, pattern, side, ignoreCase: true }
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

function findTargets(editor: vscode.TextEditor, sourceSelection: vscode.Selection, searchContext: SearchContext): vscode.Range[] | null {
    if (searchContext.type === "nodeSearchContext") {
        const source = getSource(sourceSelection, searchContext.direction);
        return findNode(sourceSelection, source, searchContext);
    }
    else if (searchContext.type === "textSearchContext") {
        const source = getSource(sourceSelection, searchContext.direction);
        const reverse = searchContext.direction === "backwards"
        const fileText = getTextRange(editor, reverse, source)
        const result = getPatternRange(source, searchContext, fileText)
        if (result !== null) {
            return [result];
        }
    }
    else if (searchContext.type === "surroundSearchContext") {
        const backwardsTargets = findTargets(editor, sourceSelection, searchContext.left)
        if (backwardsTargets === null) {
            return null;
        }
        const forwardsTargets = findTargets(editor, sourceSelection, searchContext.right);
        if (forwardsTargets !== null) {
            return [backwardsTargets[0].union(forwardsTargets[0])]
        }
    }
    return null;
}

export async function handleSurroundAction(editor: vscode.TextEditor, params: SelectInSurroundRequest['params']) {
    const count = params.count ?? 1;
    const searchContext: SurroundSearchContext = {
        type: "surroundSearchContext",
        left: { type: "textSearchContext", direction: "backwards", pattern: params.left, count, ignoreCase: true, side: null },
        right: { type: "textSearchContext", direction: "forwards", pattern: params.right, count, ignoreCase: true, side: null },
        includeLastMatch: params.includeLastMatch ?? true
    }
    const onDone = params.onDone ?? null;
    doThing2(params.action, editor, searchContext, null, onDone);
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