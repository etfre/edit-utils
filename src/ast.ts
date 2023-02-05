import * as vscode from "vscode"
import { Directive, isOptionalDirective } from "./directives";
import { yieldSubtypes } from "./nodeLoader";
import * as dsl from "./parser"
import { TreeNode } from "./types";
import { assert, reversed, sliceArray, sliceIndices } from "./util";

export let parseTreeExtensionExports: object | null = null

export async function setup() {
    const parseTreeExtension = vscode.extensions.getExtension("pokey.parse-tree");
    if (parseTreeExtension === undefined) {
        throw new Error("Depends on pokey.parse-tree extension");
    }
    parseTreeExtensionExports = await parseTreeExtension.activate()
}

export function dump(node: TreeNode, indent = 0): any {
    const type = node.type
    console.log(`${' '.repeat(indent)}${type}`)
    for (const child of node.children) {
        dump(child, indent + 2)
    }
}

export function* pathsChildrenFirst(
    node: TreeNode,
    reverse: boolean = false
): Generator<PathNode> {
    let children = reverse ? reversed(node.children) : node.children
    for (const [childIndex, child] of children.entries()) {
        for (const pathFromChild of pathsChildrenFirst(child, reverse)) {
            const root = new PathNode(node)
            root.setChild(pathFromChild, childIndex)
            yield root;
        }
    }
    yield new PathNode(node);
}


export function* search(pathNodeGenerator: Generator<PathNode>, selector: dsl.Selector, greedy: boolean): Generator<TreeNode[]> {
    for (let pathNode of pathNodeGenerator) {
        const matches = findMatches(pathNode, selector, greedy);
        if (matches.length > 0) {
            yield matches;
        }
    }
}

export function findMatches(pathNode: PathNode, selector: dsl.Selector, greedy: boolean = false): TreeNode[] {
    let matchContext = new MatchContext();
    let matches: TreeNode[] = []
    let bottomUpMatch = matchNodeEntryBottomUp(pathNode.node, selector, matchContext)
    if (bottomUpMatch !== null) {
        console.log('bottom up match')
        matches = [bottomUpMatch]
    }
    else {
        matchContext = new MatchContext()
        matches = matchNodeEntryTopDown(pathNode.node, selector, matchContext)
        const rootMatch = matchContext.rootMatch;
        if (matches.length > 0 && rootMatch) {
            matches = matches.map(match => {
                const highestMatchedOptional = traverseUpOptionals(match, rootMatch, matchContext);
                return highestMatchedOptional;
            })
            console.log('top down match')
        }
    }
    if (greedy) {
        const greedyMatches: TreeNode[] = [];
        // searching upwards so discard a match if we've already got a common ancestor
        const seenIds = new Set<number>();
        for (const match of matches) {
            let greedyMatch: TreeNode | null = match;
            let matchResult: TreeNode | null = match;
            let curr = match.parent;
            while (curr) {
                matchResult = matchNodeEntryBottomUp(curr, selector, matchContext);
                if (matchResult) {
                    if (seenIds.has(matchResult.id)) {
                        greedyMatch = null;
                        break;
                    }
                    greedyMatch = matchResult;
                    seenIds.add(matchResult.id);
                }
                curr = curr.parent;
            }
            if (greedyMatch) {
                greedyMatches.push(greedyMatch)
            }
        }
        matches = greedyMatches;
    }
    return matches;

}

export function* iterDirection(
    direction: "backwards" | "forwards",
    pathLeaf: PathNode,
    yieldDirect = false
): Generator<PathNode> {
    const isReverse = direction === "backwards";
    if (direction === "forwards") {
        const parent = pathLeaf.parent;
        const childNodes = Array.from(pathsChildrenFirst(pathLeaf.node, isReverse));
        childNodes.pop();
        for (const childPath of childNodes) {
            if (parent) {
                const parentCopy = parent.node.copyFromRoot();
                parentCopy.setChild(childPath, parent.indexOfChild);
            }
            yield childPath.getLeaf()
        }
    }
    for (const pathNode of pathLeaf.iterUp()) {
        if (yieldDirect) {
            yield pathNode;
        }
        if (pathNode.parent === null) break;
        const indexOfChild = pathNode.parent.indexOfChild
        const parent = pathNode.parent.node;
        const children = parent.node.children
        const siblingIter = isReverse ?
            sliceIndices(children, indexOfChild - 1, 0, -1) :
            sliceIndices(children, indexOfChild + 1, children.length, 1)
        for (const siblingIdx of siblingIter) {
            const sibling = children[siblingIdx]
            for (const siblingPath of pathsChildrenFirst(sibling, isReverse)) {
                const parentCopy = parent.copyFromRoot()
                parentCopy.setChild(siblingPath, siblingIdx)
                yield siblingPath.getLeaf()
            }
        }
    }
}

export function* iterClosest(from: vscode.Position, pathLeaf: PathNode): Generator<PathNode> {
    const beforeIter = iterDirection("backwards", pathLeaf, false);
    const afterIter = iterDirection("forwards", pathLeaf, false);
    let beforeCurr = beforeIter.next();
    let afterCurr = afterIter.next();
    let beforeTest = beforeCurr.done ? null : vscodePositionFromNodePosition(beforeCurr.value.node.endPosition);
    let afterTest = afterCurr.done ? null : vscodePositionFromNodePosition(afterCurr.value.node.startPosition);
    while (beforeTest !== null && afterTest !== null) {
        const compareResult = getClosest(from, beforeTest, afterTest)
        if (compareResult < 1) {
            yield beforeCurr.value;
            beforeCurr = beforeIter.next()
            beforeTest = beforeCurr.done ? null : vscodePositionFromNodePosition(beforeCurr.value.node.endPosition);
        }
        else {
            yield afterCurr.value;
            afterCurr = afterIter.next();
            afterTest = afterCurr.done ? null : vscodePositionFromNodePosition(afterCurr.value.node.endPosition);
        }
    }
    // one generator is exhausted by now so order doesn't matter anymore
    for (const beforeNode of beforeIter) {
        yield beforeNode;
    }
    for (const afterNode of afterIter) {
        yield afterNode;
    }
}

function getClosest(from: vscode.Position, a: vscode.Position, b: vscode.Position): number {
    const aLineDiff = Math.abs(from.line - a.line);
    const bLineDiff = Math.abs(from.line - b.line);
    const lineDiff = aLineDiff - bLineDiff;
    if (lineDiff !== 0) {
        return lineDiff;
    }
    const aCharDiff = Math.abs(from.character - a.character);
    const bCharDiff = Math.abs(from.character - b.character);
    return aCharDiff - bCharDiff
}

function nodesOverlap(a: TreeNode, b: TreeNode) {
    return (a.startIndex > b.startIndex && a.startIndex < b.endIndex) ||
        a.endIndex > b.startIndex && a.endIndex < b.endIndex
}


export function findNodePathToPosition(position: vscode.Position, node: TreeNode, allowApproximateMatch: boolean = true): PathNode | null {
    if (!doesNodeContainPosition(node, position) && !allowApproximateMatch) {
        return null;
    }
    const path = new PathNode(node);
    if (node.childCount > 0) {
        const childIdx = findClosestChildIndex(position, node.children, 0, node.childCount - 1);
        const childNode = node.children[childIdx];
        const isPositionInChild = doesNodeContainPosition(childNode, position);
        if (isPositionInChild || allowApproximateMatch) {
            const childResult = findNodePathToPosition(position, childNode, allowApproximateMatch)
            if (childResult !== null) {
                path.setChild(childResult, childIdx);
            }
        }
    }
    return path;
}

function findClosestChildIndex(position: vscode.Position, children: TreeNode[], low: number, high: number): number {
    if (children.length === 1) {
        return 0;
    }
    assert(low <= high);
    const mid = Math.floor((high + low) / 2);
    const child = children[mid]
    const cmp = compareNodeWithPosition(child, position);
    if (cmp === 0) {
        return mid;
    }
    else {
        // if position is less than the first or greater than the last child, just return that child
        if (cmp === -1 && mid === 0 || cmp === 1 && mid === children.length - 1) {
            return mid;
        }
        const diff = high - low;
        if (diff === 0 || (low === mid && cmp === -1) || (high === mid && cmp === 1)) {
            let midPos: vscode.Position
            let adjacentIdx: number;
            let adjacantPos: vscode.Position
            if (cmp === -1) {
                midPos = vscodePositionFromNodePosition(children[mid].startPosition)
                adjacentIdx = mid - 1;
                adjacantPos = vscodePositionFromNodePosition(children[adjacentIdx].endPosition)
            }
            else {
                midPos = vscodePositionFromNodePosition(children[mid].endPosition)
                adjacentIdx = mid + 1;
                adjacantPos = vscodePositionFromNodePosition(children[adjacentIdx].startPosition)
            }
            const adjacentNode = children[adjacentIdx];
            // tiebreaker if we don't have an exact match: default to a named node
            // if possible, otherwise the closest
            const bothNamedOrUnnamed = child.isNamed() === adjacentNode.isNamed()
            if (bothNamedOrUnnamed) {
                return getClosest(position, midPos, adjacantPos) <= 0 ? mid : adjacentIdx;
            }
            return child.isNamed() ? mid : adjacentIdx;
        }
        if (cmp === -1) {
            return findClosestChildIndex(position, children, low, mid - 1);
        }
        if (cmp === 1) {
            return findClosestChildIndex(position, children, mid + 1, high);
        }
    }
    throw new Error("")
}


function testNodeType(node: TreeNode, selector: dsl.Selector, matchContext: MatchContext) {
    const tokenType = selector.tokenType.type
    if (tokenType === "name") {
        return testTokenName(node, selector.tokenType);
    }
    if (tokenType === "choice") {
        return selector.tokenType.options.some(selectorOption => testTokenName(node, selectorOption));
    }
    assert(tokenType === "wildcard")
    return true;
}

function testTokenName(node: TreeNode, tokenType: dsl.Name) {
    const editor = vscode.window.activeTextEditor as vscode.TextEditor
    for (const nodeType of yieldSubtypes(tokenType.value, editor.document.languageId)) {
        if (nodeType === node.type) {
            return true;
        }
    }
    return false;
}

function getNextSliceMax(slice: dsl.Slice): { max: number, reverse: boolean } {
    let reverse = false;
    let max = Infinity;
    const [start, stop] = [slice.start, slice.stop];
    if (stop !== null && stop > 0) { // example: [:6] we only need to scan for the first 6 elements
        max = stop;
    }
    else if (start !== null && start < 0) { // example: [-5:] we only need to scan for the last 5 elements
        // not implemented yet because reverse needs to be handled in testNodes in several locations. YAGNI?
        // max = start;
        // reverse = true;
    }

    return { max, reverse }
    // if (slice.stop !== null && slice.stop >= 0) {
    //     return 
    // }
    // for (let i = startIdx; i < directives.length; i++) {
    //     const nodeOrDirective = directives[i];
    //     if ("start" in nodeOrDirective) {
    //         return nodeOrDirective.stop;
    //     }
    // }
    // // implicit 1 at the end
    // return 1;
}

// When searching top down, last index is implicitly [0] b/c we take the first match
function testNodes(nodes: TreeNode[], selector: dsl.Selector, matchContext: MatchContext, applyImplicitSliceAtEnd: boolean) {
    let nextMax = selector.directives.length === 1 && selector.isLastSliceImplicit ?
        { max: Infinity, reverse: false } :
        getNextSliceMax(selector.directives[0].sliceAtEnd);
    let remainingNodes: TreeNode[] = [];
    for (let node of nodes) {
        if (remainingNodes.length >= nextMax.max) {
            break;
        }
        if (testNodeType(node, selector, matchContext)) {
            remainingNodes.push(node)
        }
    }
    for (const [i, directivesGroup] of selector.directives.entries()) {
        let filteredRemainingNodes: TreeNode[] = [];
        const isLast = i === selector.directives.length - 1;
        const applySlice = !isLast || applyImplicitSliceAtEnd;
        for (const node of remainingNodes) {
            if (applySlice && remainingNodes.length >= nextMax.max) {
                break;
            }
            let nodeMatches = true;
            for (const directive of directivesGroup.directives) {
                if (!directive.matchNode(node, matchContext)) {
                    nodeMatches = false;
                    break
                }
            }
            if (nodeMatches) {
                filteredRemainingNodes.push(node);
            }
        }
        if (applySlice) {
            const slice = directivesGroup.sliceAtEnd
            filteredRemainingNodes = sliceArray(filteredRemainingNodes, slice.start, slice.stop, slice.step);
        }
        remainingNodes = filteredRemainingNodes;
    }
    return remainingNodes;
}

function matchNodesTopDown(nodes: TreeNode[], selector: dsl.Selector, matchContext: MatchContext): TreeNode[] {
    // dictionary.pair[]
    // dictionary.pair[2]
    // dictionary.pair.value
    const applyImplicitSliceAtEnd = true;
    let remainingNodes = testNodes(nodes, selector, matchContext, applyImplicitSliceAtEnd);
    const isMatch = remainingNodes.length > 0;
    const childSelector = selector.child
    const isSelectorLeaf = childSelector === null
    if (isMatch) {
        if (matchContext.rootMatch === null) {
            matchContext.rootMatch = selector;
        }
        else {
            matchContext.rootMatch = null
        }
        if (isSelectorLeaf) {
            return remainingNodes;
        }
        else {
            let subMatches: TreeNode[] = []
            for (const matchedNode of remainingNodes) {
                subMatches = subMatches.concat(matchNodesTopDown(matchedNode.children, childSelector, matchContext));
            }
            remainingNodes = subMatches;
        }
    }
    if (selector.isOptional && !isSelectorLeaf && remainingNodes.length === 0) {
        return matchNodesTopDown(nodes, childSelector, matchContext);
    }
    return remainingNodes;
}


function traverseUpOptionals(node: TreeNode, selector: dsl.Selector, matchContext: MatchContext): TreeNode {
    let highestMatch = node;
    let currNode = node.parent;
    let currSelector = selector.parent;
    while (currNode !== null && currSelector !== null) {
        if (!testNode(currNode, currSelector, matchContext)) {
            break;
        }
        highestMatch = currNode;
        currNode = currNode.parent;
        currSelector = selector.parent;
    }
    return highestMatch
}

function matchNodeEntryTopDown(node: TreeNode, selector: dsl.Selector, matchContext: MatchContext): TreeNode[] {
    const matches = matchNodesTopDown([node], selector, matchContext)
    return matches;
}

function matchNodeEntryBottomUp(node: TreeNode, selector: dsl.Selector, matchContext: MatchContext): TreeNode | null {
    const match = matchNodeEntryBottomUpHelper(node, dsl.getLeafSelector(selector), matchContext)
    if (match !== null) {
        return match;
    }
    return null;
}

function matchNodeEntryBottomUpHelper(node: TreeNode, leafSelector: dsl.Selector, matchContext: MatchContext): TreeNode | null {
    let currNode: TreeNode | null = node;
    let currSelector: dsl.Selector | null = leafSelector;
    let firstMatch: TreeNode | null = null;
    const matches: [TreeNode, dsl.Selector][] = [];
    while (currSelector !== null && currNode !== null) {
        let parent = currNode.parent;
        let nodesToTest = parent === null ? [currNode] : parent.children;
        if (currNode.type === "integer") {
            let x = 1;
        }
        const matched = testNodes(nodesToTest, currSelector, matchContext, false);
        const currId = currNode.id;
        const isMatch = currSelector.isLastSliceImplicit ? // distinguish between *[6] and *
            matched.some(x => x.id === currId) :
            matched.length === 1 && matched[0].id === currId;
        if (isMatch) {
            matches.push([currNode, currSelector])
            if (firstMatch === null) {
                firstMatch = currNode;
            }
            currSelector = currSelector.parent;
            currNode = currNode.parent === null ? null : currNode.parent;
        }
        else if (currSelector.isOptional) { // mismatch on an optional field, go to the parent selector
            currSelector = currSelector.parent;
        }
        else { // mismatch on a required field
            return null;
        }
    }
    if (firstMatch !== null) {
        // if we hit the root node with remaining selectors, need to check they're all optional
        while (currSelector !== null) {
            if (!currSelector.isOptional) {
                return null;
            }
            currSelector = currSelector.parent;
        }
    }
    return firstMatch;
}

function testNode(node: TreeNode, selector: dsl.Selector, matchContext: MatchContext) {
    const matched = testNodes([node], selector, matchContext, false);
    const isMatch = selector.isLastSliceImplicit ? // distinguish between *[6] and *
        matched.some(x => x.id === node.id) :
        matched.length === 1 && matched[0].id === node.id;
    return isMatch;
}


export function vscodePositionFromNodePosition(nodePosition: { row: number, column: number }) {
    return new vscode.Position(nodePosition.row, nodePosition.column)
}

function compareNodeWithPosition(node: TreeNode, testPosition: vscode.Position): -1 | 0 | 1 {
    const nodeStartPosition = vscodePositionFromNodePosition(node.startPosition)
    const nodeEndPosition = vscodePositionFromNodePosition(node.endPosition)
    if (testPosition.isBeforeOrEqual(nodeStartPosition)) {
        return -1
    }
    else if (testPosition.isAfterOrEqual(nodeEndPosition)) {
        return 1
    }
    return 0;
}

export function doesNodeContainPosition(node: TreeNode, testPosition: vscode.Position): boolean {
    return compareNodeWithPosition(node, testPosition) === 0;
}

export function selectionFromTreeNode(node: TreeNode, reverse = false): vscode.Selection {
    const startPosition = vscodePositionFromNodePosition(node.startPosition)
    const endPosition = vscodePositionFromNodePosition(node.endPosition)
    if (reverse) {
        return new vscode.Selection(endPosition, startPosition)
    }
    return new vscode.Selection(startPosition, endPosition)
}

export function selectionFromNodeArray(nodes: TreeNode[], reverse = false) {
    let anchor: vscode.Position | null = null
    let active: vscode.Position | null = null
    for (const node of nodes) {
        const startPosition = vscodePositionFromNodePosition(node.startPosition)
        const endPosition = vscodePositionFromNodePosition(node.endPosition)
        if (reverse) {
            if (anchor === null || endPosition.isAfter(anchor)) {
                anchor = endPosition
            }
            if (active === null || startPosition.isBefore(active)) {
                active = startPosition
            }
        }
        else {
            if (anchor === null || startPosition.isBefore(anchor)) {
                anchor = startPosition
            }
            if (active === null || endPosition.isAfter(active)) {
                active = endPosition
            }
        }
    }
    if (anchor === null || active === null) {
        throw new Error("At least one node is required for a selection")
    }
    return new vscode.Selection(anchor, active)
}

export function rangeFromNodeArray(nodes: TreeNode[]) {
    let start: vscode.Position | null = null
    let end: vscode.Position | null = null
    for (const node of nodes) {
        const startPosition = vscodePositionFromNodePosition(node.startPosition)
        const endPosition = vscodePositionFromNodePosition(node.endPosition)
        if (start === null || startPosition.isBefore(start)) {
            start = startPosition
        }
        if (end === null || endPosition.isAfter(end)) {
            end = endPosition
        }
    }
    if (start === null || end === null) {
        throw new Error("At least one node is required for a selection")
    }
    return new vscode.Range(start, end)
}

export class PathNode {

    parent: { indexOfChild: number, node: PathNode } | null
    node: TreeNode
    child: { indexInChildren: number, node: PathNode | null } | null

    constructor(node: TreeNode) {
        this.parent = null
        this.child = null
        this.node = node
    }

    isRoot() {
        return this.parent === null
    }

    isLeaf() {
        return this.child === null
    }

    getRoot(): PathNode {
        return this.parent === null ? this : this.parent.node.getRoot()
    }

    getLeaf(): PathNode {
        if (this.child === null || this.child.node === null) {
            return this;
        }
        return this.child.node.getLeaf()
    }

    setChild(child: PathNode, index: number) {
        this.child = { node: child, indexInChildren: index }
        child.parent = { node: this, indexOfChild: index }
    }

    copyFromRoot() {
        const copied = new PathNode(this.node);
        if (this.parent) {
            const parentCopy = this.parent.node.copyFromRoot()
            parentCopy.setChild(copied, this.parent.indexOfChild);
        }
        return copied;
    }

    *iterDown(): Generator<PathNode> {
        yield this
        if (this.child !== null && this.child.node !== null) {
            yield* this.child.node.iterDown()
        }
    }

    *iterUp(): Generator<PathNode> {
        yield this
        if (this.parent !== null) {
            yield* this.parent.node.iterUp()
        }
    }

    dump(): void {
        for (const pathNode of this.iterDown()) {
            console.log(pathNode.node.type)
        }
    }

}

export class MatchContext {

    mark: TreeNode[] | null
    rootMatch: dsl.Selector | null
    skippedOptionalsCount: number

    constructor() {
        this.mark = null;
        this.rootMatch = null;
        this.skippedOptionalsCount = 0;
    }
}