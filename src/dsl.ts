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
}

type NameState = string

type ParseState = {
    name: string
    numStr: string
    isOptional: boolean
    indexOrSliceState: null |
    { stage: "index" } |
    { stage: "stop", slice: Slice } |
    { stage: "step", slice: Slice } |
    ({ stage: "done", index: number } | { stage: "done", slice: Slice })
}

const DEFAULT_SLICE_VALUES = {
    start: 0,
    stop: null,
    step: 1,
}

function assertDefaultStates(states: Partial<ParseState> = {}) {
    assert(states.name === undefined || states.name === "", "Expecting empty name")
    assert(states.numStr === undefined || states.numStr === "", "Expecting empty number")
    assert(states.isOptional === undefined || states.isOptional === false, "Expecting isOptional to be false")
    assert(states.indexOrSliceState === undefined || states.indexOrSliceState === null, "Expecting indexOrSliceState to be null")
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
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
    char: "[" | ":" | "]"
): ParseState['indexOrSliceState'] {
    const isEmptyNumStr = numStr.length === 0
    if (indexOrSliceState === null || char === "[") { // check both for type narrowing
        assert(char === "[" && indexOrSliceState === null, "indexOrSliceState must be null for [")
        return { stage: "index" }
    }
    if (indexOrSliceState.stage === "done") {
        throw new Error("???")
    }
    if (indexOrSliceState.stage === "index") {
        if (char === "]") {
            if (isEmptyNumStr) { // treat empty index as full slice, e.g. dictionary.item[]
                return { stage: "done", slice: { start: 0, stop: null, step: 1 } }
            }
            return { stage: "done", index: parseNumStr(numStr) }
        }
        const start = isEmptyNumStr ? 0 : parseNumStr(numStr)
        return { stage: "step", slice: { start, stop: null, step: 1 } }
    }
    if (indexOrSliceState.stage === "stop") { // second colon
        return { stage: "step", slice: { ...indexOrSliceState.slice, stop: isEmptyNumStr ? null : parseNumStr(numStr) } }
    }
    if (indexOrSliceState.stage === "step") { // ] for slices
        assert(char === "]", "Already on slice step, too many : characters")
        return { stage: "done", slice: { ...indexOrSliceState.slice, step: isEmptyNumStr ? 1 : parseNumStr(numStr) } }
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
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char)
        }
        else if (char === ":") {
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char)
            numStr = ""
        }
        else if (char === "]") {
            indexOrSliceState = transitionIndexOrSliceState(indexOrSliceState, numStr, char)
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
    return root
}

export function isMultiple(selector: Selector) {
    return selector.slice !== null
}