import * as vscode from "vscode"
import * as dsl from "./dsl"
import { range, sliceArray } from "./util";

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

export function* walk(node: TreeNode): Generator<TreeNode> {
    yield node;
    for (const child of node.children) {
        for (const desc of walk(child)) {
            yield desc
        }
    }
}

export function* pathsChildrenFirst(
    node: TreeNode,
    indexInParent: number | null = null,
): Generator<{ indexInParent: number | null, node: TreeNode }[]> {
    const path = [{ indexInParent, node }]
    for (const [childIndex, child] of node.children.entries()) {
        for (const descPath of pathsChildrenFirst(child, childIndex)) {
            yield path.concat(descPath)
        }
    }
    yield path;
}

export function* walkChildrenFirst(node: TreeNode): Generator<TreeNode> {
    for (const child of node.children) {
        for (const desc of walkChildrenFirst(child)) {
            yield desc
        }
    }
    yield node;
}

export function* walkParents(node: TreeNode): Generator<TreeNode> {
    let curr: TreeNode | null = node.parent;
    while (curr !== null) {
        yield curr
        curr = curr.parent
    }
}

export function searchFromPosition(
    position: vscode.Position,
    root: TreeNode,
    direction: "up" | "before" | "after",
    selector: dsl.Selector,
    count = 1,
): TreeNode[] {
    const path = findNodePathToPosition(position, root);
    if (path === null) {
        return []
    }
    if (direction === "up") {
        const toCheck = path.map(x => x.node).reverse()
        for (let parent of toCheck) {
            const matches = matchSingleNode(parent, selector)
            if (matches.length > 0) {
                return matches
            }
        }
    }
    else { // before or after
        const leaf = path[path.length - 1].node
        const reversedPath = path.
            slice(1).
            map(x => {
                if (x.node.parent === null || x.indexInParent === null) {
                    throw new Error("")
                }
                return { parent: x.node.parent, indexOfChild: x.indexInParent }
            }).
            reverse()
        for (const { indexOfChild, parent } of reversedPath) {
            const siblingIter = direction === "before" ?
                range(indexOfChild, -1, -1) :
                range(indexOfChild, parent.children.length)
            for (const i of siblingIter) {
                const sibling = parent.children[i]
                for (const testNode of walkChildrenFirst(sibling)) {
                    const matches = matchSingleNode(testNode, selector)
                    if (matches.length > 0) {
                        if (matches.length === 1 && !isSameNode(leaf, matches[matches.length - 1])) {
                            return matches
                        }
                    }
                }
            }
        }
    }
    return [];
}

function findNodePathToPosition(position: vscode.Position, root: TreeNode) {
    for (const path of pathsChildrenFirst(root)) {
        const node = path[path.length - 1].node;
        if (doesNodeContainPosition(node, position)) {
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
    let isMatch = selector.isWildcard || selector.name === node.type
    const childSelector = selector.child
    const isLeaf = childSelector === null
    if (isMatch) {
        if (isLeaf) {
            matches.push(node)
        }
        else {
            const childIsMultiple = dsl.isMultiple(childSelector)
            if (childIsMultiple) {
                matches = matchMultipleNodes(node*, childSelector)
            }
            else {
                for (const child of node.children) {
                    const childResult = matchSingleNode(child, childSelector);
                    if (childResult.length > 0) {
                        return [...childResult]
                    }
                }
            }
        }
    }
    else if (selector.isOptional && !isLeaf) {
        return matchSingleNode(node, childSelector)
    }
    return matches
}

function matchMultipleNodes(parent: TreeNode,childSelector: dsl.Selector): TreeNode[] {
    let matches: TreeNode[] = []
    for (const node of parent.children) {
        const nodeMatches = matchSingleNode(node, childSelector)
        matches = matches.concat(nodeMatches)
    }
    if (childSelector.index) {
        const index = childSelector.index < 0 ? matches.length - 1 + childSelector.index : childSelector.index
        matches = [matches[index]]
    }
    if (childSelector.slice) {
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