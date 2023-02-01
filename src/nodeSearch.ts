import * as vscode from "vscode"
import * as ast from "./ast"
import { NodeSearchContext, SearchContext, TreeNode } from "./types";
import { mergeGenerators } from "./util";

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
    for (const matches of ast.search(pathNodeGeneratorFn, searchContext.selector, searchContext.greedy)) {
        const filteredMatches = matches.filter(x => filterMatch(x, selection, searchContext.direction));
        if (filteredMatches.length > 0) {
            if (searchContext.getEvery) {
                const mergedRanges = filteredMatches.map(x => ast.rangeFromNodeArray([x]));
                ranges = ranges.concat(mergedRanges)
            }
            else {
                const mergedRange = ast.rangeFromNodeArray(filteredMatches);
                ranges.push(mergedRange)
            }
            break;
        }
    }
    return ranges;
}

function filterMatch(testNode: TreeNode, selection: vscode.Selection, direction: "backwards" | "forwards" | "smart"): boolean {
    if (direction === "backwards") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isBefore(selection.start);
    }
    else if (direction === "forwards") {
        return ast.vscodePositionFromNodePosition(testNode.startPosition).isAfter(selection.end);
    }
    return true;
}