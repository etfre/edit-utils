import { assert } from "./util"

export type Selector = {
    type: "Selector"
    name: string
    isOptional: boolean
    isWildcard: boolean
    parent: Selector | null
    child: Selector | null
    index: number | null
    slice: Slice | null
}


type Slice = {
    start: number
    stop: number | null
    step: number
    isFilter: boolean
}

type SliceOrIndexState = null |
{ stage: "index", hasFilterPrefix: boolean } |
{ stage: "stop", slice: Slice } |
{ stage: "step", slice: Slice } |
    ({ stage: "done", index: number } | { stage: "done", slice: Slice })

type ParseState = {
    name: string
    numStr: string
    isOptional: boolean
    indexOrSliceState: SliceOrIndexState
}

function assertDefaultStates(states: Partial<ParseState> = {}) {
    assert(states.name === undefined || states.name === "", "Expecting empty name")
    assert(states.numStr === undefined || states.numStr === "", "Expecting empty number")
    assert(states.isOptional === undefined || states.isOptional === false, "Expecting isOptional to be false")
    assert(states.indexOrSliceState === undefined || states.indexOrSliceState === null, "Expecting indexOrSliceState to be null")
}

function defaultParseStates(): ParseState {
    const name = ""
    const numStr = ""
    const isOptional = false
    const indexOrSliceState = null
    return { name, numStr, isOptional, indexOrSliceState }
}

function parseNumStr(numStr: string): number {
    assert(numStr.length > 0 && numStr !== "-", "invalid num str")
    return parseInt(numStr)
}

function selectorFromParseState(
    name: ParseState['name'],
    isOptional: ParseState['isOptional'],
    indexOrSliceState: ParseState['indexOrSliceState'],
): Selector {
    const isWildcard = name === "*"
    const selector: Selector = {
        type: "Selector",
        name,
        isOptional,
        isWildcard,
        index: null,
        slice: null,
        parent: null,
        child: null
    }
    if (indexOrSliceState?.stage === "done") {
        if ('index' in indexOrSliceState) {
            selector.index = indexOrSliceState.index
        }
        else {
            selector.slice = indexOrSliceState.slice
        }
    }
    return selector
}

function linkSelectors(parent: Selector, child: Selector) {
    parent.child = child
    child.parent = parent
}

function transitionIndexOrSliceState(
    indexOrSliceState: ParseState['indexOrSliceState'],
    numStr: ParseState['numStr'],
    char: "[" | ":" | "]",
    prevChar: string | null,
): ParseState['indexOrSliceState'] {
    const isEmptyNumStr = numStr.length === 0
    if (indexOrSliceState === null || char === "[") { // check both for type narrowing
        assert(char === "[" && indexOrSliceState === null, "indexOrSliceState must be null for [")
        const hasFilterPrefix = prevChar === "$"
        return { stage: "index", hasFilterPrefix }
    }
    if (indexOrSliceState.stage === "done") {
        throw new Error("???")
    }
    if (indexOrSliceState.stage === "index") {
        const isFilter = indexOrSliceState.hasFilterPrefix
        if (char === "]") {
            // treat empty index as full slice, e.g. dictionary.pair[] to select all pairs in a dictionary
            assert(!isFilter, "Filter cannot be empty")
            if (isEmptyNumStr) {
                return { stage: "done", slice: { start: 0, stop: null, step: 1, isFilter: false } }
            }
            return { stage: "done", index: parseNumStr(numStr) }
        }
        const start = isEmptyNumStr ? 0 : parseNumStr(numStr)
        return { stage: "stop", slice: { start, stop: null, step: 1, isFilter } }
    }
    const slice = indexOrSliceState.slice
    if (indexOrSliceState.stage === "stop") { // second colon
        const stop = isEmptyNumStr ? null : parseNumStr(numStr)
        const stage: any = char === "]" ? "done" : "step"
        return { stage, slice: { ...slice, stop } }
    }
    if (indexOrSliceState.stage === "step") { // ] for slices
        assert(char === "]", "Already on slice step, too many : characters")
        const step = isEmptyNumStr ? 1 : parseNumStr(numStr)
        return { stage: "done", slice: { ...slice, step } }
    }
    throw new Error("???")
}

export function parseInput(input: string): Selector {
    let { name, numStr, isOptional, indexOrSliceState } = defaultParseStates()

    let prevChar: string | null = null
    let root: Selector | null = null
    let curr: Selector | null = null
    for (let char of input) {
        if (char === " ") {
            continue;
        }
        if (prevChar === "?") {
            assert(char === ".", "? must precede . or end of string")
        }
        const isLetter = char.match(/[a-z]/i)
        const isDigit = char >= '0' && char <= '9'
        if (isLetter || char === "_") {
            assertDefaultStates({ numStr, isOptional, indexOrSliceState });
            assert(name !== "*", "Cannot append to wildcard *");
            name += char;
        }
        else if (char === "*") {
            assert(name === "", "Cannot mix * with name");
            name = "*";
        }
        else if (char === "-" || isDigit) {
            assert(indexOrSliceState !== null, "Can only have numbers in index or slice")
            if (char === "-") {
                assert(numStr.length === 0, "only minus at start of int")
            }
            numStr += char
        }
        else if (char === "[") {
            assert(name.length > 0, "Must have a name for index or slice")
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char, prevChar)
        }
        else if (char === ":") {
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char, prevChar)
            numStr = ""
        }
        else if (char === "]") {
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char, prevChar)
            numStr = ""
        }
        else if (char === "?") {
            assert(isOptional === false, "Expecting isOptional to be false")
            isOptional = true
        }
        else if (char === ".") {
            const newSelector = selectorFromParseState(name, isOptional, indexOrSliceState);
            if (curr !== null) {
                linkSelectors(curr, newSelector)
            }
            if (root === null) {
                root = newSelector
            }
            curr = newSelector
            const newDefault = defaultParseStates()
            name = newDefault.name
            numStr = newDefault.numStr
            isOptional = newDefault.isOptional
            indexOrSliceState = newDefault.indexOrSliceState
        }
        else if (char === "$") {

        }
        else {
            throw new Error(`Unexpected character ${char}`)
        }
        prevChar = char
    }
    if (name.length > 0) {
        const newSelector = selectorFromParseState(name, isOptional, indexOrSliceState);
        if (curr !== null) {
            linkSelectors(curr, newSelector)
        }
        if (root === null) {
            root = newSelector
        }
        curr = newSelector
    }
    if (root === null) {
        throw new Error("No Selector successfully parsed")
    }
    // simpler if root is always a single node
    if (isMultiple(root)) {
        const newRoot: Selector = {
            type: "Selector",
            isOptional: false,
            isWildcard: true,
            name: "*",
            child: root,
            parent: null,
            index: null,
            slice: null,
        }
        root = newRoot
    }
    return root
}

export function isMultiple(selector: Selector) {
    return (selector.slice !== null && !selector.slice.isFilter) || selector.index !== null
}

export function getLeafSelector(selector: Selector): Selector {
    if (selector.child === null) {
        return selector;
    }
    return getLeafSelector(selector.child);
}