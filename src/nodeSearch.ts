import * as vscode from "vscode"
import * as ast from "./ast"
import { NodeSearchContext, SearchContext, TreeNode } from "./types";
import { assert, mergeGenerators } from "./util";

export function findNode(
    selection: vscode.Selection,
    source: vscode.Position,
    searchContext: NodeSearchContext,
): vscode.Range[] {
    const path = ast.findNodePathToPosition(source, searchContext.root)
    if (path === null) {
        return [];
    }
    const leaf = path.getLeaf();
    let pathNodeGeneratorFn: Generator<ast.PathNode>;
    if (searchContext.direction === "smart") {
        pathNodeGeneratorFn = mergeGenerators(leaf.iterUp(), ast.iterClosest(source, leaf));
    }
    else if (searchContext.direction === "backwards") {
        pathNodeGeneratorFn = ast.iterDirection("backwards", leaf, true);
    }
    else if (searchContext.direction === "forwards") {
        pathNodeGeneratorFn = ast.iterDirection("forwards", leaf, true);
    }
    else {
        throw new Error("")
    }
    let ranges: vscode.Range[] = []
    for (const matches of ast.search(pathNodeGeneratorFn, searchContext)) {
        let filteredMatches = matches.filter(x => filterMatch(x, selection, searchContext.direction));
        if (filteredMatches.length > 0) {
            if (searchContext.getInside) {

            }
            searchContext.resultInfo.matches = filteredMatches;
            if (searchContext.getEvery) {
                const mergedRanges = filteredMatches.map(x => rangeFromNodeArray([x], searchContext.getInside));
                ranges = ranges.concat(mergedRanges)
            }
            else {
                const mergedRange = rangeFromNodeArray(filteredMatches, searchContext.getInside);
                ranges.push(mergedRange)
            }
            break;
        }
    }
    return ranges;
}


function filterMatch(testNode: TreeNode, selection: vscode.Selection, direction: "backwards" | "forwards" | "smart"): boolean {
    if (direction === "backwards") {
        return ast.vscodePositionFromNodePosition(testNode.endPosition).isBefore(selection.start);
    }
    else if (direction === "forwards") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isAfter(selection.end);
    }
    return true;
}


export function rangeFromNodeArray(nodes: TreeNode[], getInside: boolean): vscode.Range {
    // nodes must be in order
    assert(nodes.length > 0, "At least one node is required for a selection");
    const startNode = nodes[0];
    if (getInside) {
        const children = startNode.children
        assert(nodes.length === 1 && children.length >= 2, "Must have a single sequence match");
        const start = ast.vscodePositionFromNodePosition(children[0].endPosition)
        const end = ast.vscodePositionFromNodePosition(children[children.length - 1].startPosition);
        return new vscode.Range(start, end)
        // We want to select after first child until the start of the last child
    }
    const endNode = nodes[nodes.length - 1];
    const start = ast.vscodePositionFromNodePosition(startNode.startPosition);
    const end = ast.vscodePositionFromNodePosition(endNode.endPosition);
    return new vscode.Range(start, end)
}