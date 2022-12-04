import * as vscode from "vscode"
import * as dsl from "./dsl"

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

export function dump(node: TreeNode): any {
    const type = node.type
    if (node.parent) {
       console.log(`${node.parent.type} => ${type}`)
    }
    else {
        console.log(type)
    }
    console.log(node.text)
    console.log('--------------------')
    for (const child of node.children) {
        dump(child)
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
    selector: dsl.Selector,
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
        condition = [condition, (node: TreeNode) => position.isBefore(vscodePositionFromNodePosition(node.startPosition))]
        iterFn = walk.bind(undefined, root)
    }
    else { // after
        condition = [condition, (node: TreeNode) => position.isAfter(vscodePositionFromNodePosition(node.endPosition))]
        iterFn = walk.bind(undefined, root)
    }
    let currCount = 0
    const normalizedCondition = normalizeCondition(condition)
    for (const node of iterFn()) {
        if (normalizedCondition(node)) {
            currCount++
            if (currCount === count) {
                return node as TreeNode
            }
        }
    }
    return null;
}

function findNodeAtPosition(position: vscode.Position, root: TreeNode) {
    for (const node of walkChildrenFirst(root)) {
        if (doesNodeContainPosition(node, position)) {
            return node
        }
    }
    return null
}

function matchNode(node: TreeNode, selector: dsl.Selector) {
    
}
function matchNodes(nodes: TreeNode[], selector: dsl.Selector) {

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
