import { Directive, isOptionalDirective, } from "./directives"
import { Lexer } from "./lexer"
import { AsteriskToken, NameToken, OpenBracketToken, OpenParenToken, PeriodToken, Token, TokenOptions, TokenType } from "./types"
import { assert, assertIsDefined, assertIsNullish, isNullish } from "./util"

export type Selector = {
    type: "Selector"
    tokenType: Name | Choice | Wildcard
    isOptional: boolean
    parent: Selector | null
    child: Selector | null
    // index: number | null
    // filter: Slice | null
    // slice: Slice | null
    isMark: boolean
    directives: { directives: Directive[], sliceAtEnd: Slice }[]
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
    options: (Name)[]
}

type SliceOrIndexState = null | { stage: "index", num?: number } | { isFilter: boolean, stage: "start" | "stop" | "step", slice: Slice }


export type Slice = {
    start: number
    stop: number | null
    step: number
}

type ParseState = {
    tokenType: null | Name | Wildcard | (Choice & { isDone: boolean, readyForOption: boolean })
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

function sliceFromIndex(index: number): Slice {
    const stop = index === -1 ? null : index + 1;
    return { start: index, stop, step: 1 }
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
    let directivesGroup: Directive[] = []
    const directives: { directives: Directive[], sliceAtEnd: Slice }[] = [];
    // if (isOptional) {
    //     directivesGroup.push(new isOptionalDirective());
    // }
    if (sliceState !== null) {
        directives.push({ directives: directivesGroup, sliceAtEnd: { ...sliceState } });
        directivesGroup = []
    }
    // if (filterState !== null) {
    //     directives.push(new FilterDirective(filterState.start, filterState.stop, filterState.step));
    // }
    if (index !== null) {
        directives.push({ directives: directivesGroup, sliceAtEnd: sliceFromIndex(index) });
        directivesGroup = []
    }
    directives.push({ directives: directivesGroup, sliceAtEnd: { start: 0, stop: 1, step: 1 } })
    const selector: Selector = {
        type: "Selector",
        tokenType: tokenType,
        isOptional,
        isMark: false,
        directives,
        parent: null,
        child: null
    }

    return selector
}

function linkSelectors(parent: Selector, child: Selector) {
    parent.child = child
    child.parent = parent
}

class NoMatch extends Error { }

class ParseError extends Error { }

class Parser {

    tokens: Token[]
    pos: number
    selectors: Selector[]
    readyForNewSelector: boolean;
    currentDirectivesGroup: Directive[]
    parseMap: { [key in TokenType]: (tok: Token) => void }[]

    constructor(tokens: Token[]) {
        this.tokens = tokens;
        this.pos = 0;
        this.selectors = []
        this.readyForNewSelector = true;
        this.currentDirectivesGroup = []
        this.parseMap = {
            ASTERISK: this.readAsterisk,
            NAME: this.readName,
            OPEN_PAREN: this.readOpenParen,
            PERIOD: this.readPeriod,
        } as any
    }

    parse(): Selector {
        while (!this.isAtEnd()) {
            const startPos = this.pos;
            this.readNext();
            assert(this.pos > startPos);
        }
        assert(this.selectors.length > 0);
        for (const [i, selector] of this.selectors.slice(0, -1).entries()) {
            const child = this.selectors[i + 1];
            selector.child = child;
            child.parent = selector;
        }
        return this.selectors[0];
    }

    readNext(): void {
        let startPos = this.pos;
        const tok = this.peek();
        if (tok.type in this.parseMap) {
            this.advance();
            //@ts-ignore
            const parseFn = this.parseMap[tok.type];
            parseFn.call(this, tok);
        }
        else {
            throw new ParseError(`No function to parse ${tok.type} at position ${this.pos}`);
        }
    }

    assert(condition: boolean, msg = ""): asserts condition {
        if (!condition) {
            throw new ParseError(msg);
        }
    }

    addSelector(selectorFields: Partial<Selector> & { tokenType: Selector['tokenType'] }) {
        this.assert(this.readyForNewSelector);
        const defaultSelectorFields = {
            type: "Selector",
            isOptional: false,
            parent: null,
            child: null,
            isMark: false,
            directives: [],
        }
        //@ts-ignore
        const selector: Selector = { ...defaultSelectorFields, ...selectorFields }
        this.selectors.push(selector);
        this.readyForNewSelector = false;
    }

    readAsterisk(tok: AsteriskToken) {
        this.addSelector({ tokenType: { type: "wildcard" } });
    }

    readName(tok: NameToken) {
        this.addSelector({ tokenType: { type: "name", value: tok.value } });
    }

    readOpenBracket(tok: OpenBracketToken) {
        this.assert(!this.readyForNewSelector)
        const currentSelector = this.selector;
        const nextTok = this.require("NUMBER", "COLON", "CLOSED_BRACKET");
        if (nextTok.type === "CLOSED_BRACKET") {

        }
    }

    readOpenParen(tok: OpenParenToken) {
        // parse as Choice, handle directive in separate fn
        let readyForOption = true;
        let options: Choice['options'] = []
        while (true) {
            let nextTok = this.peek();
            if (this.match(nextTok, "CLOSED_PAREN")) {
                this.addSelector({ tokenType: { type: "choice", options } });
                return;
            }
            else if (this.match(nextTok, "NAME")) {
                this.assert(readyForOption);
                options.push({ type: "name", value: nextTok.value });
                readyForOption = false;
            }
            else if (this.match(tok, "PIPE")) {
                readyForOption = true;
            }
            else {
                throw new Error("")
            }
            this.advance();
        }
    }

    readPeriod(tok: PeriodToken) {
        this.assert(!this.readyForNewSelector);
        this.readyForNewSelector = true;
    }

    match<T extends TokenType>(tok: Token, ...types: T[]): tok is TokenOptions<T> {
        for (const type of types) {
            if (type === tok.type) {
                return true;
            }
        }
        return false;
    }
    // match<T extends Token, V extends Token['type']>(tok: T, ...types: Token['type'][]) {
    //     return types.includes(tok.type);
    // }

    expect<T extends TokenType>(...types: TokenType[]) {
        const tok = this.peek();
        if (!types.includes(tok.type)) {
            throw new NoMatch("");
        }
        this.advance();
        return tok;
    }

    require<T extends TokenType>(...types: T[]): TokenOptions<T> {
        const tok = this.peek();
        //@ts-ignore
        if (!types.includes(tok.type)) {
            throw new ParseError("");
        }
        this.advance();
        //@ts-ignore
        return tok;
    }

    get selector(): Selector {
        return this.selectors[this.pos];
    }

    *readIter() {
        while (!this.isAtEnd()) {
            yield this.peek();
            this.advance();
        }
    }

    readWhile(condition: (tok: Token) => boolean): Token[] {
        let match = []
        for (const tok of this.readIter()) {
            if (!condition(tok)) {
                break;
            }
            match.push(tok);
        }
        return match;
    }

    peek(): Token {
        this.assert(this.pos < this.tokens.length);
        return this.tokens[this.pos];
    }

    advance(): void {
        this.pos++;
    }

    isAtEnd(): boolean {
        return this.pos >= this.tokens.length;
    }
}

export function parseInput(input: string): Selector {
    const tokens = new Lexer(input).tokenize();
    return new Parser(tokens).parse();
    // let { tokenType, isOptional, index, slice, filter, sliceOrIndexState } = defaultParseStates()

    // let root: Selector | null = null
    // let curr: Selector | null = null
    // for (let [i, token] of tokens.entries()) {
    //     const nextToken: Token | undefined = tokens[i + 1];
    //     switch (token.type) {
    //         case "QUESTION_MARK": {
    //             assert(nextToken?.type === "PERIOD", `? must precede . or end of string, not ${nextToken}`)
    //             assert(isOptional === false, "Expecting isOptional to be false")
    //             assert(sliceOrIndexState === null)
    //             isOptional = true;
    //             break;
    //         }
    //         case "ASTERISK": {
    //             assert(sliceOrIndexState === null)
    //             assert(tokenType === null);
    //             tokenType = { type: "wildcard" }
    //             break;
    //         }
    //         case "CLOSED_BRACKET": {
    //             assertIsDefined(sliceOrIndexState)
    //             if (sliceOrIndexState.stage === "index") {
    //                 const num = sliceOrIndexState.num
    //                 if (num === undefined) {
    //                     assert(slice === null);
    //                     slice = defaultSlice();
    //                 }
    //                 else {
    //                     assert(index === null);
    //                     index = num;
    //                 }
    //             }
    //             else {
    //                 assert(!sliceOrIndexState.isFilter)
    //                 slice = sliceOrIndexState.slice;
    //             }
    //             sliceOrIndexState = null;
    //             break;
    //         }
    //         case "CLOSED_CURLY_BRACE": {
    //             assertIsDefined(sliceOrIndexState);
    //             if (sliceOrIndexState.stage === "stop" || sliceOrIndexState.stage === "step") {
    //                 assert(sliceOrIndexState.isFilter)
    //                 assertIsNullish(filter)
    //                 filter = sliceOrIndexState.slice;
    //             }
    //             break;
    //         }
    //         case "CLOSED_PAREN": {
    //             assert(tokenType?.type === "choice" && !tokenType.isDone)
    //             tokenType.isDone = true;
    //             break;
    //         }
    //         case "COLON": {
    //             assertIsDefined(sliceOrIndexState);
    //             if (sliceOrIndexState.stage === "index") {
    //                 const start = sliceOrIndexState.num ?? 0;
    //                 const slice = { ...defaultSlice(), start }
    //                 sliceOrIndexState = { stage: "stop", slice, isFilter: false }
    //             }
    //             else if (sliceOrIndexState.stage === "start") {
    //                 sliceOrIndexState = { ...sliceOrIndexState, stage: "stop" }
    //             }
    //             else {
    //                 assert(sliceOrIndexState.stage === "stop")
    //                 sliceOrIndexState = { ...sliceOrIndexState, stage: "step" }
    //             }
    //             break;
    //         }
    //         case "NAME": {
    //             if (tokenType === null) {
    //                 tokenType = { type: "name", value: token.value }
    //             }
    //             else if (tokenType.type === "choice") {
    //                 assert(tokenType.readyForOption)
    //                 tokenType.options.push({ type: "name", value: token.value })
    //                 tokenType.readyForOption = false;
    //             }
    //             else {
    //                 throw new Error("Name requires null or choice tokenType")
    //             }
    //             break;
    //         }
    //         case "NUMBER": {
    //             assertIsDefined(sliceOrIndexState)
    //             if (sliceOrIndexState.stage === "index") {
    //                 sliceOrIndexState.num = token.value;
    //             }
    //             else if (sliceOrIndexState.stage === "start") {
    //                 sliceOrIndexState.slice.start = token.value
    //             }
    //             else if (sliceOrIndexState.stage === "stop") {
    //                 sliceOrIndexState.slice.stop = token.value
    //             }
    //             else if (sliceOrIndexState.stage === "step") {
    //                 sliceOrIndexState.slice.step = token.value
    //             }
    //             break;
    //         }
    //         case "OPEN_BRACKET": {
    //             assert(tokenType !== null, "Must have a name for index or slice")
    //             assert(index === null, "Index must be null")
    //             sliceOrIndexState = { stage: "index" }
    //             break;
    //         }
    //         case "OPEN_CURLY_BRACE": {
    //             sliceOrIndexState = { isFilter: true, stage: "start", slice: defaultSlice() }
    //             break;
    //         }
    //         case "OPEN_PAREN": {
    //             assert(tokenType === null)
    //             tokenType = { type: "choice", readyForOption: true, options: [], isDone: false }
    //             break;
    //         }
    //         case "PERIOD": {
    //             const newSelector = selectorFromParseState(tokenType, isOptional, index, slice, filter);
    //             if (curr !== null) {
    //                 linkSelectors(curr, newSelector)
    //             }
    //             if (root === null) {
    //                 root = newSelector
    //             }
    //             curr = newSelector
    //             const newDefault = defaultParseStates()
    //             tokenType = newDefault.tokenType
    //             isOptional = newDefault.isOptional
    //             index = newDefault.index
    //             slice = newDefault.slice
    //             filter = newDefault.filter
    //             sliceOrIndexState = newDefault.sliceOrIndexState
    //             break;
    //         }
    //         case "PIPE": {
    //             assert(tokenType?.type === "choice" && !tokenType.isDone)
    //             tokenType.readyForOption = true;
    //             break;
    //         }
    //         case "AT_SIGN": {
    //             break;
    //         }
    //         case "COMMA": {
    //             break;
    //         }
    //         case "NOT": {
    //             break;
    //         }
    //         default: {
    //             const exhaustiveCheck: never = token;
    //             throw new Error(`Unexpected token ${exhaustiveCheck}`)
    //         }
    //     }
    // }
    // if (tokenType !== null) {
    //     const newSelector = selectorFromParseState(tokenType, isOptional, index, slice, filter);
    //     if (curr !== null) {
    //         linkSelectors(curr, newSelector)
    //     }
    //     if (root === null) {
    //         root = newSelector
    //     }
    //     curr = newSelector
    // }
    // if (root === null) {
    //     throw new Error("No Selector successfully parsed")
    // }
    // // simpler if root is always a single node
    // // if (isMultiple(root)) {
    // //     const newRoot: Selector = {
    // //         type: "Selector",
    // //         isOptional: false,
    // //         tokenType: { type: "wildcard" },
    // //         child: root,
    // //         parent: null,
    // //         index: null,
    // //         filter: null,
    // //         slice: null,
    // //         directives: [],
    // //     }
    // //     root = newRoot
    // // }
    // return root
}

export function isMultiple(selector: Selector) {
    // very crude and will produce false positives b/c it doesn't handle slices intelligently, fix later
    const lastSlice = selector.directives[selector.directives.length - 1].sliceAtEnd
    return selector.directives.length > 1 || !(lastSlice.start === 0 && lastSlice.stop === 1 && lastSlice.step === 1)
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