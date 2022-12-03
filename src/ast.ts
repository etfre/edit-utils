import * as vscode from "vscode"

export let parseTreeExtensionExports: object | null = null

export async function setup() {
    const parseTreeExtension = vscode.extensions.getExtension("pokey.parse-tree");
    if (parseTreeExtension === undefined) {
        throw new Error("Depends on pokey.parse-tree extension");
    }
    parseTreeExtensionExports = await parseTreeExtension.activate()
}

type UnNormalizedCondition = string | Array<UnNormalizedCondition> | undefined | null | ((node: TreeNode) => boolean)
type NormalizedCondition = (node: TreeNode) => boolean

function normalizeCondition(condition: UnNormalizedCondition): NormalizedCondition {
    if (Array.isArray(condition)) {
        const childFns: NormalizedCondition[] = condition.map(x => normalizeCondition(x))
        return (node: TreeNode) => {
            for (const fn of childFns) {
                if (!fn(node)) {
                    return false;
                }
            }
            return true;
        }
    }
    if (condition === null || condition === undefined) {
        return (node: TreeNode) => true
    }
    if (typeof condition === "string") {
        return (node: TreeNode) => node.type === condition
    }
    return condition
}

export function* walk(node: TreeNode): Generator<TreeNode> {
    yield node;
    for (const child of node.children) {
        for (const desc of walk(child)) {
            yield desc
        }
    }
}
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
        curr = node.parent
    }
}

export function search(root: TreeNode, condition: UnNormalizedCondition) {
    condition = normalizeCondition(condition)
    for (const node of walk(root)) {
        if (condition(node)) {
            return node
        }
    }
    return null
}

export function searchFromPosition(
    position: vscode.Position,
    root: TreeNode,
    direction: "up" | "down" | "before" | "after",
    condition: UnNormalizedCondition,
    count = 1,
) {
    const node = findNodeAtPosition(position, root)
    if (node === null) {
        return null
    }
    let iterFn: any;
    if (direction === "up") {
        iterFn = walkParents.bind(undefined, node)
    }
    else if (direction === "down") {
        iterFn = walk.bind(undefined, node)
    }
    else if (direction === "before") {
        condition = [condition, (node: TreeNode) => position.isBefore(node.startPosition)]
        iterFn = walk.bind(undefined, root)
    }
    else { // after
        condition = [condition, (node: TreeNode) => position.isAfter(node.endPosition)]
        iterFn = walk.bind(undefined, root)
    }
    let currCount = 0
    const normalizedCondition = normalizeCondition(condition)
    for (const node of iterFn()) {
        console.log(node.type)
        if (normalizedCondition(node)) {
            currCount++
            if (currCount === count) {
                return node as TreeNode
            }
        }
    }
    return null
}

function findNodeAtPosition(position: vscode.Position, root: TreeNode) {
    for (const node of walk(root)) {
        console.log(node, position)
        if (doesNodeContainPosition(node, position)) {
            return node
        }
    }
    return null
}

function doesNodeContainPosition(node: TreeNode, position: vscode.Position) {
    return position.isAfterOrEqual(node.startPosition) && position.isBeforeOrEqual(node.endPosition)
}

export function selectionFromTreeNode(node: TreeNode, reverse = false): vscode.Selection {
    if (reverse) {
        return new vscode.Selection(node.endPosition, node.startPosition)
    }
    return new vscode.Selection(node.startPosition, node.endPosition)
}
