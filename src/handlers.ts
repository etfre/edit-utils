import * as vscode from 'vscode';
import { BACKWARDS_SURROUND_CHARS, FORWARDS_SURROUND_CHARS, getPatternRange } from "./textSearch"
import * as ast from "./ast"
import * as dsl from "./parser"
import { assert, mergeGenerators, unEscapeRegex } from './util';
import { ExecuteCommandRequest, ExecuteCommandsPerSelectionRequest, GoToLineRequest, NodeSearchContext, NodeTarget, OnDone, SearchContext, SelectInSurroundRequest, SmartActionParams, SurroundInsertRequest, SurroundSearchContext, Target, TextSearchContext, TextTarget, TreeNode } from './types';
import { findNode } from './nodeSearch';


export async function handlePing() {
    return {}
}

export async function handleExecuteCommandsPerSelection(editor: vscode.TextEditor, params: ExecuteCommandsPerSelectionRequest['params']) {
    for (const selection of editor.selections) {
        for (let i = 0; i < params.count; i++) {
            for (const cmd of params.commands) {
                await vscode.commands.executeCommand(cmd)
            }
        }
    }
    if (params.onDone) {
        if (params.onDone.type === "executeCommand") {
            await vscode.commands.executeCommand(params.onDone.commandName);
        }
        else {
            for (const selection of editor.selections) {
                doOnDone(editor, selection, params.onDone)
            }
        }
    }
}

export async function handleSmartAction(editor: vscode.TextEditor, params: SmartActionParams) {
    const searchContext = params.target.type === "nodeTarget" ?
        createNodeSearchContext(editor, params.target, params.getEvery ?? false) :
        createTextSearchContext(params.target);
    const side = params.target.side ?? null;
    const onDone = params.onDone ?? null;
    await doThing2(params.action, editor, searchContext, side, onDone);
}

export async function handleSurroundInsert(editor: vscode.TextEditor, params: SurroundInsertRequest['params']) {
    for (const selection of editor.selections) {
        const text = editor.document.getText(selection)
        editor.edit(builder => {
            builder.replace(selection, `${params.left}${text}${params.right}`);
        });
    }
}

export async function handleSurroundAction(editor: vscode.TextEditor, params: SelectInSurroundRequest['params']) {
    const count = params.count ?? 1;
    const left = params.left ?? BACKWARDS_SURROUND_CHARS;
    const right = params.right ?? FORWARDS_SURROUND_CHARS;
    const searchContext: SurroundSearchContext = {
        type: "surroundSearchContext",
        left: { type: "textSearchContext", direction: "backwards", pattern: left, count, ignoreCase: true, side: null, resultInfo: {} },
        right: { type: "textSearchContext", direction: "forwards", pattern: right, count, ignoreCase: true, side: null, resultInfo: {} },
        includeLastMatch: params.includeLastMatch ?? true,
        resultInfo: {}
    }
    const onDone = params.onDone ?? null;
    await doThing2(params.action, editor, searchContext, null, onDone);
}

// export async function handleSwapAction(editor: vscode.TextEditor, params: SelectInSurroundRequest['params']) {
//     const count = params.count ?? 1;
//     const firstTarget = params.left ?? BACKWARDS_SURROUND_CHARS;
//     const right = params.right ?? FORWARDS_SURROUND_CHARS;
//     const searchContext: SurroundSearchContext = {
//         type: "surroundSearchContext",
//         left: { type: "textSearchContext", direction: "backwards", pattern: left, count, ignoreCase: true, side: null, resultInfo: {} },
//         right: { type: "textSearchContext", direction: "forwards", pattern: right, count, ignoreCase: true, side: null, resultInfo: {} },
//         includeLastMatch: params.includeLastMatch ?? true,
//         resultInfo: {}
//     }
//     const onDone = params.onDone ?? null;
//     await doThing2(params.action, editor, searchContext, null, onDone);
// }

async function doThing2(
    action: "move" | "select" | "extend",
    editor: vscode.TextEditor,
    searchContext: SearchContext,
    side: "start" | "end" | null,
    onDone: OnDone | null
) {
    const newSelectionsOrRanges: (vscode.Selection | vscode.Range)[] = [];
    for (const selection of editor.selections) {
        const targets = findTargets(editor, selection, searchContext);
        if (targets === null || targets.length === 0) {
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
    if (onDone === null || !["surroundReplace"].includes(onDone.type)) {
        editor.selections = newSelections;
    }
    if (onDone !== null) {
        if (onDone.type === "executeCommand") {
            await vscode.commands.executeCommand(onDone.commandName);
        }
        else {
            for (const selection of newSelections) {
                doOnDone(editor, selection, onDone, searchContext)
            }
        }
    }
}

function doOnDone(editor: vscode.TextEditor, selection: vscode.Selection, onDone: OnDone, searchContext?: SearchContext) {
    if (onDone.type === "surroundReplace") {
        assert(searchContext?.type === "surroundSearchContext")
        const leftLength = searchContext.left.resultInfo.matchLength;
        const rightLength = searchContext.right.resultInfo.matchLength;
        const text = editor.document.getText(selection).slice(leftLength, -rightLength);
        editor.edit(builder => {
            builder.replace(selection, `${onDone.left}${text}${onDone.right}`)
        });
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

function isNodeTarget(target: Target): target is NodeTarget {
    return 'selector' in target
}

function createTextSearchContext(
    target: TextTarget,
): TextSearchContext {
    const count = target.count ?? 1;
    const side = target.side ?? null;
    const pattern = target.pattern;
    return { type: "textSearchContext", direction: target.direction, count, pattern, side, ignoreCase: true, resultInfo: {} }
}


function createNodeSearchContext(
    editor: vscode.TextEditor,
    target: NodeTarget,
    getEvery: boolean
): NodeSearchContext {
    const count = target.count ?? 1;
    const side = target.side ?? null;
    const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
    const root = tree.rootNode
    ast.dump(root);
    const selector = dsl.parseInput(target.selector);
    const greedy = target.greedy ?? false;
    return {
        type: "nodeSearchContext",
        count,
        root,
        direction: target.direction,
        selector,
        side,
        getEvery,
        greedy,
        resultInfo: {},
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
            const match = searchContext.includeLastMatch ?
                backwardsTargets[0].union(forwardsTargets[0]) :
                new vscode.Range(backwardsTargets[0].end, forwardsTargets[0].start);
            return [match]
        }
    }
    else if (searchContext.type === "currentSelectionSearchContext") {
        return [sourceSelection];
    }
    throw new Error(`Unrecognized search type: ${searchContext.type}`);
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