import { Lexer } from "./lexer"
import { Token } from "./types"
import { assert, assertIsDefined, assertIsNullish, isNullish } from "./util"

export type Selector = {
    type: "Selector"
    tokenType: Name | Choice | RuleRef | Wildcard
    isOptional: boolean
    parent: Selector | null
    child: Selector | null
    index: number | null
    filter: Slice | null
    slice: Slice | null
}

export type Name = {
    type: "name"
    value: string
}

export type Wildcard = {
    type: "wildcard"
}

export type Choice = {
    type: "choice"
    options: (Name | RuleRef)[]
}

export type RuleRef = {
    type: "ruleRef"
    ruleName: string
}

type SliceOrIndexState = null | { stage: "index", num?: number } | { isFilter: boolean, stage: "start" | "stop" | "step", slice: Slice }


type Slice = {
    start: number
    stop: number | null
    step: number
}

type ParseState = {
    tokenType: null | Name | RuleRef | Wildcard | (Choice & { isDone: boolean, readyForOption: boolean })
    isOptional: boolean
    index: number | null
    slice: Slice | null
    filter: Slice | null
    sliceOrIndexState: SliceOrIndexState
}

function defaultParseStates(): ParseState {
    const tokenType = null
    const isOptional = false
    const index = null
    const slice = null
    const filter = null
    const sliceOrIndexState = null;
    return { tokenType, isOptional, index, slice, filter, sliceOrIndexState }
}

function selectorFromParseState(
    parseTokenType: ParseState['tokenType'],
    isOptional: ParseState['isOptional'],
    index: ParseState['index'],
    sliceState: ParseState['slice'],
    filterState: ParseState['filter'],
): Selector {
    if (parseTokenType === null) {
        throw new Error("");
    }
    const tokenType: Selector['tokenType'] = parseTokenType.type === "choice" ?
        { options: parseTokenType.options, type: "choice" } :
        { ...parseTokenType };
    const selector: Selector = {
        type: "Selector",
        tokenType: tokenType,
        isOptional,
        index: index,
        filter: filterState,
        slice: sliceState,
        parent: null,
        child: null
    }

    return selector
}

function linkSelectors(parent: Selector, child: Selector) {
    parent.child = child
    child.parent = parent
}


export function parseInput(input: string): Selector {
    const tokens = new Lexer(input).tokenize();
    let { tokenType, isOptional, index, slice, filter, sliceOrIndexState } = defaultParseStates()

    let root: Selector | null = null
    let curr: Selector | null = null
    for (let [i, token] of tokens.entries()) {
        const nextToken: Token | undefined = tokens[i + 1];
        switch (token.type) {
            case "QUESTION_MARK": {
                assert(nextToken?.type === "PERIOD", `? must precede . or end of string, not ${nextToken}`)
                assert(isOptional === false, "Expecting isOptional to be false")
                assert(sliceOrIndexState === null)
                isOptional = true;
                break;
            }
            case "ASTERISK": {
                assert(sliceOrIndexState === null)
                assert(tokenType === null);
                tokenType = { type: "wildcard" }
                break;
            }
            case "CLOSED_BRACKET": {
                assertIsDefined(sliceOrIndexState)
                if (sliceOrIndexState.stage === "index") {
                    const num = sliceOrIndexState.num
                    if (num === undefined) {
                        assert(slice === null);
                        slice = defaultSlice();
                    }
                    else {
                        assert(index === null);
                        index = num;
                    }
                }
                else {
                    assert(!sliceOrIndexState.isFilter)
                    slice = sliceOrIndexState.slice;
                }
                sliceOrIndexState = null;
                break;
            }
            case "CLOSED_CURLY_BRACE": {
                assertIsDefined(sliceOrIndexState);
                if (sliceOrIndexState.stage === "stop" || sliceOrIndexState.stage === "step") {
                    assert(sliceOrIndexState.isFilter)
                    assertIsNullish(filter)
                    filter = sliceOrIndexState.slice;
                }
                break;
            }
            case "CLOSED_PAREN": {
                assert(tokenType?.type === "choice" && !tokenType.isDone)
                tokenType.isDone = true;
                break;
            }
            case "COLON": {
                assertIsDefined(sliceOrIndexState);
                if (sliceOrIndexState.stage === "index") {
                    const start = sliceOrIndexState.num ?? 0;
                    const slice = { ...defaultSlice(), start }
                    sliceOrIndexState = { stage: "stop", slice, isFilter: false }
                }
                else if (sliceOrIndexState.stage === "start") {
                    sliceOrIndexState = { ...sliceOrIndexState, stage: "stop" }
                }
                else {
                    assert(sliceOrIndexState.stage === "stop")
                    sliceOrIndexState = { ...sliceOrIndexState, stage: "step" }
                }
                break;
            }
            case "NAME": {
                if (tokenType === null) {
                    tokenType = { type: "name", value: token.value }
                }
                else if (tokenType.type === "choice") {
                    assert(tokenType.readyForOption)
                    tokenType.options.push({ type: "name", value: token.value })
                    tokenType.readyForOption = false;
                }
                else {
                    throw new Error("Name requires null or choice tokenType")
                }
                break;
            }
            case "RULE_REF": {
                if (tokenType === null) {
                    tokenType = { type: "ruleRef", ruleName: token.ruleName }
                }
                else if (tokenType.type === "choice") {
                    assert(tokenType.readyForOption)
                    tokenType.options.push({ type: "ruleRef", ruleName: token.ruleName })
                    tokenType.readyForOption = false;
                }
                break;
            }
            case "NUMBER": {
                assertIsDefined(sliceOrIndexState)
                if (sliceOrIndexState.stage === "index") {
                    sliceOrIndexState.num = token.value;
                }
                else if (sliceOrIndexState.stage === "start") {
                    sliceOrIndexState.slice.start = token.value
                }
                else if (sliceOrIndexState.stage === "stop") {
                    sliceOrIndexState.slice.stop = token.value
                }
                else if (sliceOrIndexState.stage === "step") {
                    sliceOrIndexState.slice.step = token.value
                }
                break;
            }
            case "OPEN_BRACKET": {
                assert(tokenType !== null, "Must have a name for index or slice")
                assert(index === null, "Index must be null")
                sliceOrIndexState = { stage: "index" }
                break;
            }
            case "OPEN_CURLY_BRACE": {
                sliceOrIndexState = { isFilter: true, stage: "start", slice: defaultSlice() }
                break;
            }
            case "OPEN_PAREN": {
                assert(tokenType === null)
                tokenType = {type: "choice", readyForOption: true, options: [], isDone: false}
                break;
            }
            case "PERIOD": {
                const newSelector = selectorFromParseState(tokenType, isOptional, index, slice, filter);
                if (curr !== null) {
                    linkSelectors(curr, newSelector)
                }
                if (root === null) {
                    root = newSelector
                }
                curr = newSelector
                const newDefault = defaultParseStates()
                tokenType = newDefault.tokenType
                isOptional = newDefault.isOptional
                index = newDefault.index
                slice = newDefault.slice
                filter = newDefault.filter
                sliceOrIndexState = newDefault.sliceOrIndexState
                break;
            }
            case "PIPE": {
                assert(tokenType?.type === "choice" && !tokenType.isDone)
                tokenType.readyForOption = true;
                break;
            }
            case "AT_SIGN": {
                break;
            }
            case "NOT": {
                break;
            }
            default: {
                const exhaustiveCheck: never = token;
                throw new Error(`Unexpected token ${exhaustiveCheck}`)
            }
        }
    }
    if (tokenType !== null) {
        const newSelector = selectorFromParseState(tokenType, isOptional, index, slice, filter);
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
            tokenType: { type: "wildcard" },
            child: root,
            parent: null,
            index: null,
            filter: null,
            slice: null,
        }
        root = newRoot
    }
    return root
}

export function isMultiple(selector: Selector) {
    return selector.slice !== null || selector.index !== null
}

export function getLeafSelector(selector: Selector): Selector {
    if (selector.child === null) {
        return selector;
    }
    return getLeafSelector(selector.child);
}

function defaultSlice(): Slice {
    return { start: 0, stop: null, step: 1 }
}