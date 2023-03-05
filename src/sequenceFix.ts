import { TreeNode } from "./types";
import { assert } from "./util";


// [1,2,,3] -> [1,2,3]
// foo(a, b, ,,) -> foo(a, b)
export function fixSequence(seq: TreeNode, sep: string, removeTrailingSep = false): string { 
    const children = seq.children;
    
    assert(children.length >= 2 && !children[0].isNamed() && !children[children.length - 1].isNamed())
    let result = "";
    for (let child of children.slice(1, -1)) {
                        
    }
    return result;
}