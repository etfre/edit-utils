import { MatchContext } from "./ast";
import { TreeNode } from "./types";
import { assert } from "./util";



export interface Directive {
    matchNode(node: TreeNode, matchContext: MatchContext): boolean
    matchNodes?: never
}

// export type Directive = SingleNodeDirective

export class MarkDirective {
    matchNodes(nodes: TreeNode[], matchContext: MatchContext): TreeNode[] {
        assert(matchContext.mark === null)
        matchContext.mark = nodes;
        return nodes
    }
}

export class NameDirective implements Directive {
    testName: string
    constructor(testName: string) {
        this.testName = testName
    }
    matchNode(node: TreeNode, matchContext: MatchContext): boolean {
        return node.text === this.testName
    }
}

export class isNamedDirective implements Directive {
    matchNode(node: TreeNode, matchContext: MatchContext): boolean {
        return node.isNamed()
    }
}

export class isOptionalDirective implements Directive {
    matchNode(node: TreeNode, matchContext: MatchContext): boolean {
        return true;
    }
}

// export function isSingleDirective(directive: Directive): directive is Directive {
//     return "matchNode" in directive;
// }

export const mapNameToDirective = {
    isNamed: isNamedDirective,
    name: NameDirective,
    mark: MarkDirective,
}