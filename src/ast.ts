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

export function searchFromPosition(
    position: vscode.Position,
    root: TreeNode,
    direction: "up" | "before" | "after",
    selectors: dsl.Selector[],
    count = 1,
): TreeNode[] {
    const path = findNodePathToPosition(position, root);
    if (path === null) {
        return []
    }
    if (direction === "up") {
        const toCheck = path.map(x => x.node).reverse()
        for (let parent of toCheck) {
            const { matches, selector } = matchNodeEntry(parent, selectors)
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
        const reversedPath = path.
            slice(1).
            map(x => {
                if (x.node.parent === null || x.indexInParent === null) {
                    throw new Error("")
                }
                return { parent: x.node.parent, indexOfChild: x.indexInParent }
            }).
            reverse()
        return matchDirection(direction, selectors, reversedPath)
    }
    return [];
}

function matchDirection(
    direction: "before" | "after",
    selectors: dsl.Selector[],
    childFirstPath: { indexOfChild: number, parent: TreeNode }[],
    matchTarget: number = 1
): TreeNode[] {
    let gotMatchContainingLeaf = false;
    const seen = new Set<TreeNode>();
    for (const nodeDetails of iterDirection(direction, childFirstPath)) {
        if (seen.has(nodeDetails.node)) {
            continue
        }
        const { matches, selector } = matchNodeEntry(nodeDetails.node, selectors)
        if (matches.length === 0) {
            continue;   
        }
        const formattedMatches = matches.map(match => {
            const addedOptionals = traverseUpOptionals(match, selector as dsl.Selector);
            for (const node of addedOptionals) {
                seen.add(node)
            }
            return addedOptionals.length === 0 ? match : addedOptionals[0]
        })
        /* 
        Skip the first match if it contains our starting point, for example:

        def foo():
            def bar():
                pass

        If the cursor is in pass and the command is "select previous function definition" then
        we should skip bar and go to foo because bar is the current function definition and
        foo if the previous one.
        */
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
    childFirstPath: { indexOfChild: number, parent: TreeNode }[]
): Generator<{ node: TreeNode, isAncestor: boolean }> {
    for (const { indexOfChild, parent } of childFirstPath) {
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
    let isMatch = testNode(node, selector)
    const childSelector = selector.child
    const isSelectorLeaf = childSelector === null
    if (isMatch) {
        if (isSelectorLeaf) {
            matches.push(node)
        }
        else {
            matchNodeChildren(node.children, childSelector);
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
    while (!testNode(match, currSelector)) {
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