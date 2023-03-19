import * as vscode from 'vscode';
import { BACKWARDS_SURROUND_CHARS, FORWARDS_SURROUND_CHARS, getPatternRange } from "./textSearch"
import * as ast from "./ast"
import * as dsl from "./parser"
import { assert, ensureSelection, mergeGenerators, shrinkSelection, unEscapeRegex } from './util';
import {
    CurrentSelectionSearchContext, ExecuteCommandRequest, ExecuteCommandsPerSelectionRequest,
    GoToLineRequest, IdentAutocompleteRequest, InsertTextRequest, NodeSearchContext, NodeTarget, OnDone, SearchContext, SelectInSurroundRequest,
    SmartActionParams, SurroundInsertRequest, SurroundSearchContext, SwapRequest, Target,
    TextSearchContext, TextTarget, TreeNode
} from './types';
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
    const searchContext: CurrentSelectionSearchContext = { type: "currentSelectionSearchContext", resultInfo: {} }
    if (params.onDone) {
        if (params.onDone.type === "executeCommand") {
            await vscode.commands.executeCommand(params.onDone.commandName);
        }
        else {
            const selectionSearchResults: MatchDetails[] = [{ selections: editor.selections, onDoneTargets: editor.selections }];
            await doOnDone(editor, selectionSearchResults, params.onDone, searchContext)
        }
    }
}

export async function handleSmartAction(editor: vscode.TextEditor, params: SmartActionParams) {
    assert(["select", "move", "extend"].includes(params.action));
    const getEvery = params.getEvery ?? false;
    const searchContext = params.target.type === "nodeTarget" ?
        createNodeSearchContext(editor, params.target, getEvery) :
        createTextSearchContext(params.target);
    const side = params.target.side ?? null;
    const onDone = params.onDone ?? null;
    await doThing2(params.action, editor, searchContext, side, onDone);
}

export async function handleSurroundInsert(editor: vscode.TextEditor, params: SurroundInsertRequest['params']) {
    const searchContext: CurrentSelectionSearchContext = { type: "currentSelectionSearchContext", resultInfo: {} }
    const onDone: OnDone = { type: "surroundInsert", left: params.left, right: params.right }
    await doThing2("select", editor, searchContext, null, onDone);
}

export async function handleSurroundAction(editor: vscode.TextEditor, params: SelectInSurroundRequest['params']) {
    assert(["select", "move", "extend"].includes(params.action))
    const count = params.count ?? 1;
    const left = params.left ?? BACKWARDS_SURROUND_CHARS;
    const right = params.right ?? FORWARDS_SURROUND_CHARS;
    const side = params.side ?? null;
    const searchContext: SurroundSearchContext = {
        type: "surroundSearchContext",
        left: { type: "textSearchContext", direction: "backwards", pattern: left, count, ignoreCase: true, side: null, useAntiPattern: true, resultInfo: {} },
        right: { type: "textSearchContext", direction: "forwards", pattern: right, count, ignoreCase: true, side: null, useAntiPattern: true, resultInfo: {} },
        includeLastMatch: params.includeLastMatch ?? true,
        resultInfo: {}
    }
    const onDone = params.onDone ?? null;
    await doThing2(params.action, editor, searchContext, side, onDone);
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
    else if (odt === "copy" || odt === "cut" || odt === "delete" || odt === "paste" || odt === "surroundInsert" || odt === "surroundReplace") {
        return { selections: [selection], onDoneTargets: matchedSelections }
    }
    else if (odt === "moveAndDelete" || odt === "moveAndPaste") {
        return { selections: matchedSelections, onDoneTargets: matchedSelections }
    }
    else {
        throw new Error("");
    }
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
        if (targets.length === 0) {
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
        doOnDone(editor, selectionSearchResults, onDone, searchContext)
    }
}

async function doOnDone(editor: vscode.TextEditor, selectionSearchResults: MatchDetails[], onDone: OnDone, searchContext: SearchContext) {
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
        assert(searchContext?.type === "surroundSearchContext")
        const startLength = searchContext.left.resultInfo.matchLength as number;
        const endLength = searchContext.right.resultInfo.matchLength as number;
        // const slicedSelections = matchedSelections.map(x => shrinkSelection(x, -startLength, -endLength));
        editor.edit(builder => {
            for (const target of allTargets) {
                const text = editor.document.getText(target).slice(startLength, -endLength);
                builder.replace(target, `${onDone.left}${text}${onDone.right}`)
            }
        });
    }
    if (odt === "surroundInsert") {
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
            const clipContents = await vscode.env.clipboard.readText();
            const clipLines = clipContents.split("\n");
            //TODO
        }
        editor.edit(builder => {
            for (const target of allTargets) {
                builder.replace(target, replaceWith)
            }
        });
    }
    else if (odt === "fixSequence") {

    }
    else {
        throw new Error("")
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

function createTextSearchContext(
    target: TextTarget,
): TextSearchContext {
    const count = target.count ?? 1;
    const side = target.side ?? null;
    const pattern = target.pattern;
    return { type: "textSearchContext", direction: target.direction, count, pattern, side, ignoreCase: true, useAntiPattern: true, resultInfo: {} }
}


function createNodeSearchContext(
    editor: vscode.TextEditor,
    target: NodeTarget,
    getEvery: boolean,
): NodeSearchContext {
    const count = target.count ?? 1;
    const side = target.side ?? null;
    const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
    const root = tree.rootNode
    // ast.dump(root);
    const selector = dsl.parseInput(target.selector);
    const greedy = target.greedy ?? false;
    const getInside = target.inside ?? false;
    return {
        type: "nodeSearchContext",
        count,
        root,
        direction: target.direction,
        selector,
        side,
        getEvery,
        getInside,
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

function findTargets(editor: vscode.TextEditor, sourceSelection: vscode.Selection, searchContext: SearchContext): vscode.Range[] {
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
        if (backwardsTargets.length === 0) {
            return [];
        }
        const forwardsTargets = findTargets(editor, sourceSelection, searchContext.right);
        if (forwardsTargets.length > 0) {
            const match = searchContext.includeLastMatch ?
                backwardsTargets[0].union(forwardsTargets[0]) :
                new vscode.Range(backwardsTargets[0].end, forwardsTargets[0].start);
            return [match]
        }
        return []
    }
    else if (searchContext.type === "currentSelectionSearchContext") {
        return [sourceSelection];
    }
    throw new Error(`Unrecognized search type: ${searchContext}`);
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
    const getEvery = params.getEvery ?? false;
    const searchContext1 = createNodeSearchContext(editor, params.target1, getEvery);
    const searchContext2 = createNodeSearchContext(editor, params.target2, getEvery);
    const toReplace: [vscode.Range, string][] = [];
    for (const selection of editor.selections) {
        const targets1 = findTargets(editor, selection, searchContext1);
        if (targets1.length === 0) {
            continue;
        }
        const targets2 = findTargets(editor, selection, searchContext2);
        if (targets2.length !== targets1.length) {
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
    await editor.edit(builder => {
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

export async function handleInsertText(editor: vscode.TextEditor, params: InsertTextRequest['params']) {
    const newSelections: string[] = []
    const toDelete: vscode.Selection[] = []
    for (const sel of editor.selections) {
        let selText = params.text;
        let start = sel.start;
        if (params.startSpaces !== null) {
            selText = " ".repeat(params.startSpaces) + selText;
            let testStart = start.translate(0, -1);
            while (testStart.character > 0 && editor.document.getText(new vscode.Range(testStart, start)) === " ") {
                start = testStart;
                testStart = start.translate(0, -1);
            }
        }
        let end = sel.end;
        if (params.endSpaces !== null) {
            selText = selText + " ".repeat(params.endSpaces);
            let testEnd = end.translate(0, 1);
            while (editor.document.getText(new vscode.Range(end, testEnd)) === " ") {
                end = testEnd;
                testEnd = end.translate(0, 1);
            }
        }
        toDelete.push(new vscode.Selection(start, end));
        newSelections.push(selText);
    }
    await editor.edit(builder => {
        for (const deleteSel of toDelete) {
            builder.delete(deleteSel);
        }
    })
    await editor.edit(builder => {
        for (const [i, sel] of editor.selections.entries()) {
            const newText = newSelections[i];
            builder.insert(sel.end, newText);
        }
    });
}

const identTypesByLang: Record<string, string[]> = {
    python: ["identifier", "attribute"],
    javascript: ["identifier", "property_identifier"],
    typescript: ["identifier", "property_identifier"],
}

export async function handleIdentAutocomplete(editor: vscode.TextEditor, params: IdentAutocompleteRequest['params']) {
    assert(editor.document.languageId in identTypesByLang)
    const identTypes = identTypesByLang[editor.document.languageId];
    const tree = (ast.parseTreeExtensionExports as any).getTree(editor.document)
    const root = tree.rootNode
    // ast.dump(root);
    const test = "[a-z0-9_]+";
    const fullPattern = "[a-z_][a-z0-9_]*"
    const replaceWith: { location: vscode.Range, value: string }[] = []
    const appendText = params.text ?? "";
    for (const selection of editor.selections) {
        const leftSearch: TextSearchContext = {
            type: "textSearchContext", direction: "backwards", pattern: test,
            count: 1, ignoreCase: true, side: null, useAntiPattern: false, resultInfo: {}
        }
        const rightSearch: TextSearchContext = {
            type: "textSearchContext", direction: "forwards", pattern: test,
            count: 1, ignoreCase: true, side: null, useAntiPattern: false, resultInfo: {}
        }
        const active = selection.active
        const sourceSelection = new vscode.Selection(active, active);

        const backwardsTargets = findTargets(editor, sourceSelection, leftSearch);
        const start = backwardsTargets.length === 0 || backwardsTargets[0].start.line !== active.line ?
            active :
            backwardsTargets[0].start;

        const forwardsTargets = findTargets(editor, sourceSelection, rightSearch);
        const end = forwardsTargets.length === 0 || forwardsTargets[0].start.line !== active.line ?
            active :
            forwardsTargets[0].end;

        const target = new vscode.Range(start, end)
        const identText = editor.document.getText(target) + appendText;
        if (identText.length === 0 || identText.match(new RegExp(fullPattern, "i")) === null) {
            continue;
        }
        const path = ast.findNodePathToPosition(active, root);
        assert(path !== null);
        const leaf = path.getLeaf()
        for (const node of ast.iterDirection("backwards", leaf, true)) {
            const nodeText = node.node.text;
            const autocompleteFromNode = identTypes.includes(node.node.type) &&
                nodeText.startsWith(identText) &&
                nodeText.length > identText.length;
            if (autocompleteFromNode) {
                replaceWith.push({ location: target, value: nodeText })
                break;
            }
        }
    }
    editor.edit(builder => {
        for (const { location: range, value } of replaceWith) {
            builder.replace(range, value)
        }
    })
}