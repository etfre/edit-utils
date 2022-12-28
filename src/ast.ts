import * as vscode from "vscode"
import * as dsl from "./parser"
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


export function* search(pathNodeGenerator: Generator<PathNode>, selectors: dsl.Selector[]): Generator<TreeNode[]> {
    for (let pathNode of pathNodeGenerator) {
        const matches = findMatches(pathNode, selectors);
        if (matches.length > 0) {
            yield matches;
        }
    }
}

export function findMatches(pathNode: PathNode, selectors: dsl.Selector[]): TreeNode[] {
    const match = matchNodeEntryBottomUp(pathNode, selectors)
    if (match !== null) {
        return [match];
    }
    else {
        const { matches, selector } = matchNodeEntry(pathNode.node, selectors)
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
    direction: "before" | "after",
    pathLeaf: PathNode,
    yieldDirect = false
): Generator<PathNode> {
    const isReverse = direction === "before";
    for (const pathNode of pathLeaf.iterUp()) {
        if (yieldDirect) {
            yield pathNode;
        }
        if (pathNode.parent === null) break;
        const indexOfChild = pathNode.parent.indexOfChild
        const parent = pathNode.parent.node;
        const children = parent.node.children
        const siblingIter = isReverse ?
            range(indexOfChild - 1, -1, -1) :
            range(indexOfChild + 1, children.length)
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

function* iterClosest(from: vscode.Position, pathLeaf: PathNode): Generator<PathNode> {
    const beforeIter = iterDirection("after", pathLeaf, false);
    const afterIter = iterDirection("after", pathLeaf, false);
    let beforeCurr = beforeIter.next();
    let afterCurr = afterIter.next();
    if (!beforeCurr.done && !afterCurr.done) {
        let beforeTest = vscodePositionFromNodePosition(beforeCurr.value.node.endPosition);
        let afterTest = vscodePositionFromNodePosition(beforeCurr.value.node.endPosition);
        while (!beforeCurr.done && !afterCurr.done) {
            const compareResult = getClosest(from, beforeTest, afterTest) 
            if (compareResult < 1) {
                yield beforeCurr.value;
                beforeCurr = beforeIter.next()
                beforeTest = vscodePositionFromNodePosition(beforeCurr.value.node.endPosition);
            }
            else {
                yield afterCurr.value;
                afterCurr = afterIter.next()
                afterTest = vscodePositionFromNodePosition(afterCurr.value.node.endPosition);
            }
        }
    }
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
    if (aLineDiff < bLineDiff) {
        return -1;  
    }
    if (aLineDiff > bLineDiff) {
        return 1;
    }
    const aCharDiff = Math.abs(from.character - a.character);
    const bCharDiff = Math.abs(from.character - b.character);
    if (aCharDiff < bCharDiff) {
        return -1;
    }
    if (aCharDiff > bCharDiff) {
        return 1;
    }
    return 0;
}

function nodesOverlap(a: TreeNode, b: TreeNode) {
    return (a.startIndex > b.startIndex && a.startIndex < b.endIndex) ||
        a.endIndex > b.startIndex && a.endIndex < b.endIndex
}

// TODO: this can be a recursive binary search for O(depth*logn) instead of O(n) performance
export function findNodePathToPosition(position: vscode.Position, root: TreeNode) {
    for (const path of pathsChildrenFirst(root)) {
        const leafNode = path.getLeaf().node
        if (doesNodeContainPosition(leafNode, position)) {
            return path;
        }
    }
    return null;
}

function matchSingleNode(node: TreeNode, selector: dsl.Selector): TreeNode[] {
    // dictionary.pair[]
    // dictionary.pair[2]
    // dictionary.pair.value
    let matches: TreeNode[] = []
    let isMatch = testNode(node, selector)
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
    if (tokenType.type === "name") {
        return tokenType.value === node.type;
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

function matchNodeEntry(node: TreeNode, selectors: dsl.Selector[]): { matches: TreeNode[], selector: dsl.Selector | null } {
    for (const selector of selectors) {
        const matches = matchSingleNode(node, selector)
        if (matches.length > 0) {
            return { matches, selector }
        }
    }
    return { matches: [], selector: null }
}
function matchNodeEntryBottomUp(node: PathNode, selectors: dsl.Selector[]): TreeNode | null {
    for (const selector of selectors) {
        const match = matchNodeEntryBottomUpHelper(node, dsl.getLeafSelector(selector))
        if (match !== null) {
            return match;
        }
    }
    return null;
}

function matchNodeEntryBottomUpHelper(node: PathNode, leafSelector: dsl.Selector): TreeNode | null {
    let currNode: PathNode | null = node;
    let currSelector: dsl.Selector | null = leafSelector;
    let firstMatch: TreeNode | null = null;
    while (currSelector !== null && currNode !== null) {
        // traversing up we're testing one particular node so any multiple selector doesn't match
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

function doesNodeContainPosition(node: TreeNode, position: vscode.Position) {
    const nodeStartPosition = vscodePositionFromNodePosition(node.startPosition)
    const nodeEndPosition = vscodePositionFromNodePosition(node.endPosition)
    return position.isAfterOrEqual(nodeStartPosition) && position.isBeforeOrEqual(nodeEndPosition)
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

export class PathNode {

    parent: { indexOfChild: number, node: PathNode } | null
    node: TreeNode
    child: { indexInChildren: number, node: PathNode } | null

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
        return this.child === null ? this : this.child.node.getLeaf()
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
        if (this.child !== null) {
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