import * as vscode from "vscode"
import * as dsl from "./dsl"
import { assert, range, sliceArray } from "./util";

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
): Generator<PathNode> {
    for (const [childIndex, child] of node.children.entries()) {
        for (const pathFromChild of pathsChildrenFirst(child)) {
            const root = new PathNode(node)
            root.setChild(pathFromChild, childIndex)
            yield root;
        }
    }
    yield new PathNode(node);
}

export function searchFromPosition(
    position: vscode.Position,
    root: TreeNode,
    direction: "up" | "before" | "after",
    selectors: dsl.Selector[],
    count = 1,
): TreeNode[] {
    const path = findNodePathToPosition(position, root)
    if (path === null) {
        return []
    }
    const leaf = path.getLeaf();
    path?.dump()
    if (direction === "up") {
        for (let pathNode of leaf.iterUp()) {
            const { matches, selector } = matchNodeEntry(pathNode.node, selectors)
            if (matches.length > 0) {
                const formattedMatches = matches.map(match => {
                    const addedOptionals = traverseUpOptionals(match, selector as dsl.Selector);
                    return addedOptionals.length === 0 ? match : addedOptionals[0]
                })
                return formattedMatches
            }
        }
    }
    else { // before or after
        return matchDirection(direction, selectors, leaf)
    }
    return [];
}

function matchDirection(
    direction: "before" | "after",
    selectors: dsl.Selector[],
    pathLeaf: PathNode,
    matchTarget: number = 1
): TreeNode[] {
    let gotMatchContainingLeaf = false;
    const seen = new Set<string>();
    for (const nodeDetails of iterDirection(direction, pathLeaf)) {
        if (seen.has(encodeNode(nodeDetails.node))) {
            continue
        }
        const { matches, selector } = matchNodeEntry(nodeDetails.node, selectors)
        if (matches.length === 0) {
            continue;
        }
        const formattedMatches = matches.map(match => {
            const addedOptionals = traverseUpOptionals(match, selector as dsl.Selector);
            for (const node of addedOptionals) {
                // use seen so we don't count added optionals multiple times
                seen.add(encodeNode(node))
            }
            return addedOptionals.length === 0 ? match : addedOptionals[0]
        })
        /* Skip the first match if it contains our starting point, for example:

        def foo():
            def bar():
                pass

        If the cursor is in pass and the command is "select previous function definition" then
        we should skip bar and go to foo because bar is the current function definition and
        foo if the previous one. */
        if (nodeDetails.isAncestor && !gotMatchContainingLeaf) {
            gotMatchContainingLeaf = true;
            continue;
        }
        return formattedMatches;
    }
    return [];
}

function* iterDirection(
    direction: "before" | "after",
    pathLeaf: PathNode
): Generator<{ node: TreeNode, isAncestor: boolean }> {
    for (const pathNode of pathLeaf.iterUp()) {
        if (pathNode.parent === null) break;
        const indexOfChild = pathNode.parent.indexOfChild
        const parent = pathNode.parent.node.node
        const siblingIter = direction === "before" ?
            range(indexOfChild - 1, -1, -1) :
            range(indexOfChild + 1, parent.children.length)
        for (const siblingIdx of siblingIter) {
            const sibling = parent.children[siblingIdx]
            yield { node: sibling, isAncestor: false }
        }
        yield { node: parent, isAncestor: true }
    }
}

function nodesOverlap(a: TreeNode, b: TreeNode) {
    return (a.startIndex > b.startIndex && a.startIndex < b.endIndex) ||
        a.endIndex > b.startIndex && a.endIndex < b.endIndex
}

// TODO: this can be a recursive binary search for O(depth*logn) instead of O(n) performance
function findNodePathToPosition(position: vscode.Position, root: TreeNode) {
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
    return selector.isWildcard || selector.name === node.type
}

function matchNodeChildren(children: TreeNode[], selector: dsl.Selector) {
    const childIsMultiple = dsl.isMultiple(selector)
    if (childIsMultiple) {
        return matchMultipleNodes(children, selector);
    }
    else {
        if (selector.slice?.isFilter) {
            const slice = selector.slice;
            children = sliceArray(children, slice.start, slice.stop, slice.step)
        }
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

function vscodePositionFromNodePosition(nodePosition: { row: number, column: number }) {
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

function isSameNode(a: TreeNode, b: TreeNode) {
    return a.startPosition.column === b.startPosition.column &&
        a.endPosition.column === b.endPosition.column &&
        a.text === b.text &&
        a.type === b.type
}


class PathNode {

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
        assert(this.child === null, "Node already has a child")
        assert(child.parent === null, "Child node already has a parent")
        this.child = {node: child, indexInChildren: index}
        child.parent = {node: this, indexOfChild: index}
    }

    *iterDown(): Generator<PathNode> {
        yield this
        if (this.child !== null) {
            for (const desc of this.child.node.iterDown()) {
                yield desc
            }
        }
    }

    *iterUp(): Generator<PathNode> {
        yield this
        if (this.parent !== null) {
            for (const ancesctor of this.parent.node.iterUp()) {
                yield ancesctor
            }
        }
    }

    dump(): void {
        for (const pathNode of this.iterDown()) {
            console.log(pathNode.node.type)
        }
    }

}

function encodeNode(node: TreeNode) {
    return `${node.startIndex}_${node.endIndex}_${node.type}`
}