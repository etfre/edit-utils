// import * as vscode from "vscode"

type JSONValue =
    | string
    | number
    | boolean
    | null
    | JSONValue[]
    | { [key: string]: JSONValue }

interface JSONObject {
    [k: string]: JSONValue
}
interface JSONArray extends Array<JSONValue> { }

type RequestBase = {
    jsonrpc: "2.0"
    method: string
    params?: JSONValue
    id: string
}

type PingRequest = RequestBase & {
    method: "PING"
}

type SelectUntilPatternRequest = RequestBase & {
    method: "SELECT_UNTIL_PATTERN"
    params: {
        pattern: string,
        antiPattern?: string,
        count?: number,
        deleteSelection?: boolean
        isMove?: boolean
        ignoreCase?: boolean
        reverse?: boolean
        isPatternInclude?: boolean
    }
}
type SelectInSurroundRequest = RequestBase & {
    method: "SELECT_IN_SURROUND"
    params: {
        left: string,
        right: string,
        count?: number,
        deleteSelection?: boolean
        ignoreCase?: boolean
        isPatternInclude?: boolean
    }
}

type SelectNodeRequest = RequestBase & {
    method: "SELECT_NODE",
    params: {
        type: string,
        pattern: string,
        patterns: string[],
        direction: "up" | "before" | "after"
        selectAction: "all" | "each"
        count?: number
    }
}

type GetActiveDocumentRequest = RequestBase & {
    method: "GET_ACTIVE_DOCUMENT"
}


type ClientRequest = PingRequest | SelectUntilPatternRequest | SelectInSurroundRequest | GetActiveDocumentRequest | SelectNodeRequest

type ClientResponseResult = JSONValue

type ClientResponseError = {
    code: number
    message: string
    data?: JSONValue
}

type ClientResponse = { jsonrpc: "2.0", id: string } & ({ result: ClientResponseResult } | { error: ClientResponseError })

type TreeNode = {
    childCount: number
    children: Array<TreeNode>
    endIndex: number
    endPosition: { row: number, column: number }
    parent: TreeNode | null
    startIndex: number
    startPosition: { row: number, column: number }
    type: string
    text: string
}


type NameToken = {
    type: "NAME"
    value: string
}

type NumberToken = {
    type: "NUMBER"
    value: number
}

type OpenCurlyBraceToken = {
    type: "OPEN_CURLY_BRACE"
}

type ClosedCurlyBraceToken = {
    type: "CLOSED_CURLY_BRACE"
}

type OpenBracketToken = {
    type: "OPEN_BRACKET"
}

type ClosedBracketToken = {
    type: "CLOSED_BRACKET"
}
type OpenParenToken = {
    type: "OPEN_PAREN"
}

type ClosedParenToken = {
    type: "CLOSED_PAREN"
}

type ColonToken = {
    type: "COLON"
}

type PeriodToken = {
    type: "PERIOD"
}

type RuleRefToken = {
    type: "RULE_REF"
    ruleName: string
}

type AsteriskToken = {
    type: "ASTERISK"
}

type QuestionMarkToken = {
    type: "QUESTION_MARK"
}

type PipeToken = {
    type: "PIPE"
}

type Token = 
    | NameToken 
    | NumberToken
    | OpenCurlyBraceToken 
    | ClosedCurlyBraceToken 
    | OpenBracketToken 
    | ClosedBracketToken 
    | OpenParenToken 
    | ClosedParenToken 
    | ColonToken 
    | PeriodToken 
    | RuleRefToken
    | AsteriskToken
    | QuestionMarkToken
    | PipeToken