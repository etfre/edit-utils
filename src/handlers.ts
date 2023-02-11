import * as vscode from 'vscode';
import { BACKWARDS_SURROUND_CHARS, FORWARDS_SURROUND_CHARS, getPatternRange } from "./textSearch"
import * as ast from "./ast"
import * as dsl from "./parser"
import { assert, ensureSelection, mergeGenerators, shrinkSelection, unEscapeRegex } from './util';
import { CurrentSelectionSearchContext, ExecuteCommandRequest, ExecuteCommandsPerSelectionRequest, GoToLineRequest, NodeSearchContext, NodeTarget, OnDone, SearchContext, SelectInSurroundRequest, SmartActionParams, SurroundInsertRequest, SurroundSearchContext, SwapRequest, Target, TextSearchContext, TextTarget, TreeNode } from './types';
import { findNode } from './nodeSearch';
import { focusAndSelectBookmarks, setBookmarkFromSelection } from './bookmark';


export async function handlePing() {
    return {}
}

export async function handleExecuteCommandsPerSelection(editor: vscode.TextEditor, params: ExecuteCommandsPerSelectionRequest['params']) {
    for (let i = 0; i < params.count; i++) {
        for (const cmd of params.commands) {
            await vscode.commands.executeCommand(cmd)
        }
    }
    if (params.onDone) {
        if (params.onDone.type === "executeCommand") {
            await vscode.commands.executeCommand(params.onDone.commandName);
        }
        else {
            const selectionSearchResults: MatchDetails[] = [{selections:editor.selections, onDoneTargets: editor.selections}];
            await doOnDone(editor, selectionSearchResults, params.onDone)
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
    const searchContext: CurrentSelectionSearchContext = {type: "currentSelectionSearchContext", resultInfo: {}}
    const onDone: OnDone = {type: "surroundInsert", left: params.left, right: params.right}
    await doThing2("select", editor, searchContext, null, onDone);
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

type MatchDetails = {
    selections: readonly vscode.Selection[]
    onDoneTargets: readonly (vscode.Selection | vscode.Selection[])[]
}

function translateMatches(
    action: "move" | "select" | "extend",
    onDone: OnDone | null,
    matchedTargets: vscode.Range[],
    selection: vscode.Selection,
    side: "start" | "end" | null,
    searchContext: SearchContext,
): MatchDetails {
    if (action === "move") {
        const selections = matchedTargets.map(x => ensureSelection(side == null ? x.start : x[side]))
        return { selections, onDoneTargets: [] }
    }
    if (action === "extend") {
        const extended: vscode.Selection[] = []
        for (const target of matchedTargets) {
            const newTarget = side === null ? target : new vscode.Range(target[side], target[side]);
            if (selection.active.isBefore(selection.anchor) && newTarget.start.isBefore(selection.active)) {
                extended.push(new vscode.Selection(selection.anchor, newTarget.start));
            }
            else {
                const merged = ensureSelection(selection.union(newTarget));
                extended.push(merged);
            }
        }
        return { selections: extended, onDoneTargets: [] }
    }
    const matchedSelections = matchedTargets.map(x => ensureSelection(x))
    const odt = onDone?.type ?? null; 
    if (odt === null) {
        return { selections: matchedSelections, onDoneTargets: [] }
    }
    else if (odt === "executeCommand") {
        return { selections: matchedSelections, onDoneTargets: matchedSelections }
    }
    else if (odt === "copy" || odt === "cut" || odt === "delete" || odt === "paste" || odt === "surroundInsert") {
        return { selections: [selection], onDoneTargets: matchedSelections }
    }
    else if (odt === "moveAndDelete" || odt === "moveAndPaste") {
        return { selections: matchedSelections, onDoneTargets: matchedSelections }
    }
    else if (odt === "surroundReplace") {
        assert(searchContext?.type === "surroundSearchContext")
        const startLength = searchContext.left.resultInfo.matchLength as number;
        const endLength = searchContext.right.resultInfo.matchLength as number;
        const slicedSelections = matchedSelections.map(x => shrinkSelection(x, startLength, endLength));
        return { selections: [selection], onDoneTargets: slicedSelections }
    }
    throw new Error("")
}

async function doThing2(
    action: "move" | "select" | "extend",
    editor: vscode.TextEditor,
    searchContext: SearchContext,
    side: "start" | "end" | null,
    onDone: OnDone | null
) {
    let selectionSearchResults: MatchDetails[] = [];
    for (const selection of editor.selections) {
        const targets = findTargets(editor, selection, searchContext);
        if (targets === null || targets.length === 0) {
            continue;
        }
        selectionSearchResults.push(translateMatches(action, onDone, targets, selection, side, searchContext));
    }
    if (selectionSearchResults.length === 0) {
        return;
    }
    let newSelections: vscode.Selection[] = [];
    for (const matchResult of selectionSearchResults) {
        newSelections = newSelections.concat(matchResult.selections)
    }
    if (newSelections.length > 0) {
        editor.selections = newSelections;
    }
    if (onDone !== null) {
        doOnDone(editor, selectionSearchResults, onDone)
    }
}

async function doOnDone(editor: vscode.TextEditor, selectionSearchResults: MatchDetails[], onDone: OnDone) {
    const odt = onDone.type;
    if (odt === "executeCommand") {
        await vscode.commands.executeCommand(onDone.commandName);
        return;
    }
    let allTargets: vscode.Selection[] = [];
    for (const result of selectionSearchResults) {
        const flattened = (result.onDoneTargets ?? []).flat();
        allTargets = allTargets.concat(flattened);
    }
    if (odt === "surroundReplace") {
        editor.edit(builder => {
            for (const target of allTargets) {
                const text = editor.document.getText(target);
                builder.replace(target, `${onDone.left}${text}${onDone.right}`)
            }
        });
    }
    else if (odt === "copy" || odt === "cut") {
        const newClip: string[] = [];
        for (const sel of allTargets) {
            newClip.push(editor.document.getText(sel));
        }
        await vscode.env.clipboard.writeText(newClip.join("\n"));
        if (odt === "cut") {
            editor.edit(builder => {
                for (const target of allTargets) {
                    builder.replace(target, "")
                }
            });
        }
        else {
            vscode.window.showInformationMessage('Copied text');
        }
    }
    else if (odt === "delete" || odt === "moveAndDelete" || odt === "moveAndPaste" || odt === "paste") {
        let replaceWith = ""
        if (odt === "moveAndPaste" || odt === "paste") {
            const clipContents  = await vscode.env.clipboard.readText();
            const clipLines = clipContents.split("\n");
            //TODO
        }
        editor.edit(builder => {
            for (const target of allTargets) {
                builder.replace(target, replaceWith)
            }
        });
    }
    else if (odt === "surroundInsert") {
        for (const selection of allTargets) {
            const text = editor.document.getText(selection)
            editor.edit(builder => {
                builder.replace(selection, `${onDone.left}${text}${onDone.right}`);
            });
        }
    }
    throw new Error("") 
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
    // ast.dump(root);
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
        return []
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

export async function handleSwap(editor: vscode.TextEditor, params: SwapRequest['params']) {
    const searchContext1 = createNodeSearchContext(editor, params.target1, params.getEvery ?? false)
    const searchContext2 = createNodeSearchContext(editor, params.target2, params.getEvery ?? false)
    const toReplace: [vscode.Range, string][] = [];
    for (const selection of editor.selections) {
        const targets1 = findTargets(editor, selection, searchContext1);
        if (targets1 === null || targets1.length === 0) {
            continue;
        }
        const targets2 = findTargets(editor, selection, searchContext2);
        if (targets2 === null || targets2.length !== targets1.length) {
            continue;
        }
        for (const [i, target1] of targets1.entries()) {
            const target2 = targets2[i];
            const text1 = editor.document.getText(target1);
            const text2 = editor.document.getText(target2);
            toReplace.push([target1, text2])
            toReplace.push([target2, text1])
        }
    }
    editor.edit(builder => {
        for (const [target, text] of toReplace) {
            builder.replace(target, text)
        }
    });

}

export async function handleSetBookmarks(editor: vscode.TextEditor, params: {}) {
    setBookmarkFromSelection(editor);
}

export async function handleFocusAndSelectBookmark(editor: vscode.TextEditor, params: {}) {
    focusAndSelectBookmarks(editor);
}