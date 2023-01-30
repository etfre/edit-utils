import { Directive, isOptionalDirective, mapNameToDirective, } from "./directives"
import { Lexer } from "./lexer"
import { AsteriskToken, AtSignToken, NameToken, OpenBracketToken, OpenParenToken, PeriodToken, QuestionMarkToken, Token, TokenOptions, TokenType } from "./types"
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
    isLastSliceImplicit: boolean
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

export type Slice = {
    start: number
    stop: number | null
    step: number
}

function sliceFromIndex(index: number): Slice {
    const stop = index === -1 ? null : index + 1;
    return { start: index, stop, step: 1 }
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
            AT_SIGN: this.readAtSign,
            NAME: this.readName,
            OPEN_BRACKET: this.readOpenBracket,
            OPEN_PAREN: this.readOpenParen,
            QUESTION_MARK: this.readQuestionMark,
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
        this.finalizeLeafSelector();
        for (const [i, selector] of this.selectors.slice(0, -1).entries()) {
            const child = this.selectors[i + 1];
            linkSelectors(selector, child);
        }
        return this.selectors[0];
    }

    readNext(): void {
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

    finalizeLeafSelector() {
        const leafSelector = this.lastSelector;
        if (this.currentDirectivesGroup.length > 0 || leafSelector.directives.length === 0) {
            leafSelector.directives.push({directives: [...this.currentDirectivesGroup], sliceAtEnd: {start: 0, stop: 1, step: 1}});
            leafSelector.isLastSliceImplicit = true;
        }
        this.currentDirectivesGroup = []
    }

    assert(condition: boolean, msg = ""): asserts condition {
        if (!condition) {
            throw new ParseError(msg);
        }
    }

    addSelector(selectorFields: Partial<Selector> & { tokenType: Selector['tokenType'] }) {
        this.assert(this.readyForNewSelector && this.currentDirectivesGroup.length === 0);
        const defaultSelectorFields = {
            type: "Selector",
            isOptional: false,
            parent: null,
            child: null,
            isMark: false,
            directives: [],
            isLastSliceImplicit: false
        }
        //@ts-ignore
        const selector: Selector = { ...defaultSelectorFields, ...selectorFields }
        this.selectors.push(selector);
        this.readyForNewSelector = false;
    }

    readAtSign(tok: AtSignToken) {
        const directive = this.readDirective();
        this.currentDirectivesGroup.push(directive);
    }

    readDirective(): Directive {
        const name = this.require("NAME").value;
        assert(name in mapNameToDirective)
        const directiveCls = mapNameToDirective[name as keyof typeof mapNameToDirective]
        if (this.isAtEnd() || !this.match(this.peek(), "OPEN_PAREN")) {
            //@ts-ignore
            return new directiveCls();
        }
        this.advance();
        let readyForArg = true;
        const args: (string | number)[] = []
        while (true) {
            const tok = this.require("NAME", "NUMBER", "COMMA", "CLOSED_PAREN");
            if (tok.type === "CLOSED_PAREN") {
                break;
            }
            else if (tok.type === "COMMA") {
                assert(!readyForArg);
                readyForArg = true;
            }
            else {
                assert(readyForArg);
                args.push(tok.value);
            }
        }
        //@ts-ignore
        return new directiveCls(...args);
    }

    readQuestionMark(tok: QuestionMarkToken) {
        this.assert(!this.lastSelector.isOptional)
        this.lastSelector.isOptional = true;
    }

    readPeriod(tok: PeriodToken) {
        this.assert(!this.readyForNewSelector)
        this.finalizeLeafSelector();
        this.readyForNewSelector = true;
    }
    readAsterisk(tok: AsteriskToken) {
        this.addSelector({ tokenType: { type: "wildcard" } });
    }

    readName(tok: NameToken) {
        this.addSelector({ tokenType: { type: "name", value: tok.value } });
    }

    readOpenBracket(tok: OpenBracketToken) {
        const slice = this.readSlice();
        const currentSelector = this.lastSelector;
        currentSelector.directives.push({directives: [...this.currentDirectivesGroup], sliceAtEnd: slice});
        this.currentDirectivesGroup = [];
    }

    readSlice(): Slice {
        this.assert(!this.readyForNewSelector)
        let stages = ["start", "stop", "step"] as const;
        let stageIdx = 0;
        let colonRequired = false;
        if (this.match(this.peek(), "CLOSED_BRACKET")) { // []
            this.advance();
            return {start: 0, stop: null, step: 1};
        } 
        let slice: Slice = defaultSlice();
        while (stageIdx < stages.length) {
            const stage = stages[stageIdx];
            const nextTok = this.require("NUMBER", "COLON", "CLOSED_BRACKET");
            if (nextTok.type === "CLOSED_BRACKET") {
                return stage === "start" ? sliceFromIndex(slice.start) : slice;
            }
            if (nextTok.type === "NUMBER") {
                this.assert(!colonRequired);
                slice[stage] = nextTok.value;
                colonRequired = true;
                if (stage === "step") {
                    break;
                }
            }
            else {
                colonRequired = false;
                stageIdx++;
            }

        }
        this.require("CLOSED_BRACKET");
        return slice;
    }


    readOpenParen(tok: OpenParenToken) {
        // parse as Choice, handle directive in separate fn
        let readyForOption = true;
        let options: Choice['options'] = []
        while (true) {
            let nextTok = this.require("CLOSED_PAREN", "NAME", "PIPE");
            if (nextTok.type === "CLOSED_PAREN") {
                this.addSelector({ tokenType: { type: "choice", options } });
                return;
            }
            else if (nextTok.type === "NAME") {
                this.assert(readyForOption);
                options.push({ type: "name", value: nextTok.value });
                readyForOption = false;
            }
            else if (nextTok.type === "PIPE") {
                readyForOption = true;
            }
        }
    }

    match<T extends TokenType>(tok: Token, ...types: T[]): tok is TokenOptions<T> {
        for (const type of types) {
            if (type === tok.type) {
                return true;
            }
        }
        return false;
    }

    expect<T extends TokenType>(...types: T[]): TokenOptions<T> {
        const tok = this.peek();
        //@ts-ignore
        if (!types.includes(tok.type)) {
            throw new NoMatch("");
        }
        this.advance();
        //@ts-ignore
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

    get lastSelector(): Selector {
        assert(this.selectors.length > 0);
        return this.selectors[this.selectors.length - 1];
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
    console.log(input);
    const tokens = new Lexer(input).tokenize();
    return new Parser(tokens).parse();
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