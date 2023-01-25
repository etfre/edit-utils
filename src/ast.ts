import * as vscode from "vscode"
import { yieldSubtypes } from "./nodeLoader";
import * as dsl from "./parser"
import { TreeNode } from "./types";
import { assert, range, reversed, sliceArray, sliceIndices } from "./util";

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


export function* search(pathNodeGenerator: Generator<PathNode>, selector: dsl.Selector): Generator<TreeNode[]> {
    for (let pathNode of pathNodeGenerator) {
        const matches = findMatches(pathNode, selector);
        if (matches.length > 0) {
            yield matches;
        }
    }
}

export function findMatches(pathNode: PathNode, selector: dsl.Selector): TreeNode[] {
    const match = matchNodeEntryBottomUp(pathNode, selector)
    if (match !== null) {
        return [match];
    }
    else {
        const matches = matchNodeEntry(pathNode.node, selector)
        if (matches.length > 0) {
            const formattedMatches = matches.map(match => {
                const addedOptionals = traverseUpOptionals(match, selector as dsl.Selector);
                return addedOptionals.length === 0 ? match : addedOptionals[0]
            })
            return formattedMatches
        }
    }
    return [];
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


export function findNodePathToPosition(position: vscode.Position, node: TreeNode, allowApproximateMatch: boolean = true ): PathNode | null {
    if (!doesNodeContainPosition(node, position) && !allowApproximateMatch) {
        return null;
    }
    const path = new PathNode(node);
    if (node.childCount > 0) {
        const childIdx = findClosestChildIndex(position, node.children, 0, node.childCount - 1);
        const childNode = node.children[childIdx];
        const isPositionInChild = doesNodeContainPosition(childNode, position);
        if (isPositionInChild|| allowApproximateMatch) {
            const childResult = findNodePathToPosition(position, childNode, allowApproximateMatch)
            if (childResult !== null) {
                path.setChild(childResult, childIdx);
            }
        }
        // this indicates we have a non-leaf node but none of the children contain the position
        // else if (allowApproximateMatch) {
        //     path.setChild(new PathNode(childNode), childIdx);
        // }
    }
    return path;
}

function findClosestChildIndex(position: vscode.Position, children: TreeNode[], low: number, high: number): number {
    if (low > high) {
        throw new Error("");
    }
    if (children.length === 1) {
        return 0;
    }
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
        if (diff === 0) {
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
            if (child.isNamed() && !adjacentNode.isNamed()) {
                return mid;
            }
            else if (adjacentNode.isNamed()) {
                return adjacentIdx;
            }
            return getClosest(position, midPos, adjacantPos) >= 0 ? mid : adjacentIdx
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

function matchSingleNode(node: TreeNode, selector: dsl.Selector): TreeNode[] {
    // dictionary.pair[]
    // dictionary.pair[2]
    // dictionary.pair.value
    let matches: TreeNode[] = []
    let isMatch = testNode(node, selector);
    const childSelector = selector.child
    const isSelectorLeaf = childSelector === null
    if (isMatch) {
        if (isSelectorLeaf) {
            matches.push(node)
        }
        else {
            return matchNodeChildren(node.children, childSelector);
        }
    }
    else if (selector.isOptional && !isSelectorLeaf) {
        return matchSingleNode(node, childSelector);
    }
    return matches
}

function testNode(node: TreeNode, selector: dsl.Selector) {
    if (selector.tokenType.type === "name" || selector.tokenType.type === "ruleRef") {
        return testTokenNameOrRuleRef(node, selector.tokenType);
    }

    if (selector.tokenType.type === "choice") {
        return selector.tokenType.options.some(selectorOption => testTokenNameOrRuleRef(node, selectorOption));
    }
    assert(selector.tokenType.type === "wildcard")
    return true;
}

function testTokenNameOrRuleRef(node: TreeNode, tokenType: dsl.Name | dsl.RuleRef) {
    const editor = vscode.window.activeTextEditor as vscode.TextEditor
    if (tokenType.type === "name") {
        for (const nodeType of yieldSubtypes(tokenType.value, editor.document.languageId)) {
            if (nodeType === node.type) {
                return true;
            }
        }
        return false;
    }
    throw new Error("unimplemented ruleref")
}

function matchNodeChildren(children: TreeNode[], selector: dsl.Selector) {
    const childIsMultiple = dsl.isMultiple(selector)
    if (selector.filter !== null) {
        const filterSlice = selector.filter;
        children = sliceArray(children, filterSlice.start, filterSlice.stop, filterSlice.step)
    }
    if (childIsMultiple) {
        return matchMultipleNodes(children, selector);
    }
    else {
        for (const child of children) {
            const childResult = matchSingleNode(child, selector);
            if (childResult.length > 0) {
                return [...childResult];
            }
        }
    }
    return []
}

function traverseUpOptionals(match: TreeNode, selector: dsl.Selector): TreeNode[] {
    let currSelector = selector;
    let optionalsBeforeMatch = 0;
    while (currSelector.isOptional && !testNode(match, currSelector)) {
        optionalsBeforeMatch++
        currSelector = currSelector.child as dsl.Selector
    }
    // only add optional matches at start if matched depth is one, e.g. decorated_function?.function_definition
    // but not decorated_function?.function_definition.name
    let addedOptionals: TreeNode[] = []
    if (currSelector.child === null) {
        let parentTestNode = match.parent;
        let parentTestSelector = currSelector.parent as dsl.Selector
        for (let i = 0; i < optionalsBeforeMatch; i++) {
            if (parentTestNode === null) {
                break
            }
            if (testNode(parentTestNode, parentTestSelector)) {
                addedOptionals.push(parentTestNode)
                parentTestNode = parentTestNode;
                parentTestSelector = parentTestSelector.parent as dsl.Selector
            }
        }
    }
    return addedOptionals.reverse()
}

function matchNodeEntry(node: TreeNode, selector: dsl.Selector): TreeNode[] {
    const matches = matchSingleNode(node, selector)
    if (matches.length > 0) {
        return matches;
    }
    return []
}
function matchNodeEntryBottomUp(node: PathNode, selector: dsl.Selector): TreeNode | null {
    const match = matchNodeEntryBottomUpHelper(node, dsl.getLeafSelector(selector))
    if (match !== null) {
        return match;
    }
    return null;
}

function matchNodeEntryBottomUpHelper(node: PathNode, leafSelector: dsl.Selector): TreeNode | null {
    let currNode: PathNode | null = node;
    let currSelector: dsl.Selector | null = leafSelector;
    let firstMatch: TreeNode | null = null;
    while (currSelector !== null && currNode !== null) {
        // traversing up we're testing one particular node so any multiple selector doesn't match
        const currParent = currNode.parent;
        if (dsl.isMultiple(currSelector)) {
            return null;
        }
        if (testNode(currNode.node, currSelector)) {
            if (nodeIsFilteredOut(currNode, currSelector)) {
                return null;
            }
            if (firstMatch === null) {
                firstMatch = currNode.node;
            }
            currSelector = currSelector.parent;
            currNode = currNode.parent === null ? null : currNode.parent.node;
        }
        else if (currSelector.isOptional) { // mismatch on an optional field, go to the parent selector
            currSelector = currSelector.parent;
        }
        else { // mismatch on a required field
            return null;
        }
    }
    return firstMatch;
}

function nodeIsFilteredOut(node: PathNode, selector: dsl.Selector) {
    const filterSlice = selector.filter
    if (filterSlice === null) {
        return false;
    }
    const parent = node.parent;
    const [children, indexOfChild] = parent === null ? [[node.node], 0] : [parent.node.node.children, parent.indexOfChild];
    for (const idx of sliceIndices(children, filterSlice.start, filterSlice.stop, filterSlice.step)) {
        if (idx === indexOfChild) {
            return false;
        }
    }
    return true;
}


function matchMultipleNodes(nodes: TreeNode[], childSelector: dsl.Selector): TreeNode[] {
    let matches: TreeNode[] = []
    for (const node of nodes) {
        const nodeMatches = matchSingleNode(node, childSelector)
        matches = matches.concat(nodeMatches)
    }
    if (childSelector.index !== null) {
        const index = childSelector.index < 0 ? matches.length - 1 + childSelector.index : childSelector.index
        matches = [matches[index]]
    }
    if (childSelector.slice !== null) {
        const slice = childSelector.slice
        matches = sliceArray(matches, slice.start, slice.stop, slice.step)
    }
    return matches
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