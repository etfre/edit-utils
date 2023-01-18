import assert = require("assert");
import { Token } from "./types";

export class Lexer {

    input: string;
    pos: number;

    constructor(input: string) {
        this.input = input;
        this.pos = 0;
    }

    *readIter() {
        while (!this.isAtEnd()) {
            yield this.peek();
            this.advance();
        }
    }

    readWhile(condition: (char: string) => boolean): string {
        let match = ""
        for (const char of this.readIter()) {
            if (!condition(char)) {
                break;
            }
            match += char;
        }
        return match;
    }

    isNameChar(char: string): boolean {
        return char.match(/[a-z_]/i) !== null
    }

    isDigit(char: string): boolean {
        return char.match(/[0-9]/i) !== null
    }

    readNext(char: string): Token {
        const isLetter = this.isNameChar(char)

        if (isLetter) {
            const name = this.readWhile(x => this.isNameChar(x))
            return { type: "NAME", value: name }
        }
        else if (char === "-" || this.isDigit(char)) {
            this.advance();
            const remainder = this.readWhile(x => this.isDigit(x))
            if (char === "-" && remainder.length === 0) {
                throw new Error("Invalid number, got - but no digits");
            }
            const num = parseInt(char + remainder);
            assert(!isNaN(num))
            return { type: "NUMBER", value: num }
        }
        else if (char === "!") {
            return { type: "NOT" }
        }
        else if (char === "\"") {
            this.advance();
            let strContents = "";
            let isEscape = false;
            for (const char of this.readIter()) {
                if (isEscape) {
                    strContents += char;
                    isEscape = false;
                    continue;
                }
                if (char === "\"") {
                    break;
                }
                if (char === "\\") {
                    isEscape = true;
                    continue;
                }
                strContents += char;
            }
            this.advance()
            if (strContents.length === 0) {
                throw new Error("Empty string");
            }
            return { type: "NAME", value: strContents }
        }
        else if (char === "{") {
            return { type: "OPEN_CURLY_BRACE" }
        }
        else if (char === "}") {
            return { type: "CLOSED_CURLY_BRACE" }
        }
        else if (char === "[") {
            return { type: "OPEN_BRACKET" }
        }
        else if (char === "]") {
            return { type: "CLOSED_BRACKET" }
        }
        else if (char === "(") {
            return { type: "OPEN_PAREN" }
        }
        else if (char === ")") {
            return { type: "CLOSED_PAREN" }
        }
        else if (char === "@") {
            return {type: "AT_SIGN"}
        }
        else if (char === "|") {
            return { type: "PIPE" }
        }
        else if (char === ":") {
            return { type: "COLON" }
        }
        else if (char === ".") {
            return { type: "PERIOD" }
        }
        else if (char === "*") {
            return { type: "ASTERISK" }
        }
        else if (char === "$") {
            this.advance();
            const ruleName = this.readWhile(x => this.isNameChar(x))
            if (ruleName.length === 0) {
                throw new Error("Got $ but no rule name");
            }
            return { type: "RULE_REF", ruleName }
        }
        else if (char === "?") {
            return { type: "QUESTION_MARK" }
        }
        throw new Error(`Unrecognized character ${char}`)
    }

    tokenize(): Token[] {
        const tokens: Token[] = [];
        while (!this.isAtEnd()) {
            const char = this.peek();
            if (char === " ") {
                this.advance();
                continue;
            }
            const startPos = this.pos
            const tok = this.readNext(char);
            if (this.pos === startPos) {
                this.advance();
            }
            tokens.push(tok)
        }
        return tokens;
    }

    isAtEnd() {
        return this.pos >= this.input.length;
    }

    peek(): string {
        assert(!this.isAtEnd())
        return this.input[this.pos]
    }

    advance(): void {
        this.pos++
    }

}