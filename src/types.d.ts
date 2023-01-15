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

type ExecuteCommandRequest = RequestBase & {
    method: "EXECUTE_COMMAND"
    params: {
        command: string,
        args?: any[]
    }
}

type GoToLineRequest = RequestBase & {
    method: "GO_TO_LINE"
    params: {
        line: number,
    }
}

type SelectNodeRequest = RequestBase & {
    method: "SELECT_NODE",
    params: {
        type: string,
        pattern: string,
        patterns: string[],
        direction: "up" | "before" | "after"
        selectType: "block" | "each"
        count?: number
    }
}

type SmartActionRequest = RequestBase & {
    method: "SELECT_NODE",
    params: {
        type: string,
        pattern: string,
        patterns: string[],
        direction: "up" | "before" | "after"
        selectType: "block" | "each"
        count?: number
    }
}

type GetActiveDocumentRequest = RequestBase & {
    method: "GET_ACTIVE_DOCUMENT"
}


type ClientRequest =
    | PingRequest
    | SelectUntilPatternRequest
    | SelectInSurroundRequest
    | GetActiveDocumentRequest
    | SelectNodeRequest
    | ExecuteCommandRequest
    | GoToLineRequest

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

type AtSignToken = {
    type: "AT_SIGN"
}

type PipeToken = {
    type: "PIPE"
}

type NotToken = {
    type: "NOT"
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
    | AtSignToken
    | QuestionMarkToken
    | PipeToken
    | NotToken

type Action = "move" | "select" | "extend" | "swap"

type Source = "anchor" | "active" | "start" | "end"

type NodeTarget = {
    selector: string,
    count?: number
    // direction: "backwards" | "forwards" | "smart"
}

type TextTarget = {
    pattern: string
    count?: number
    // antiPattern?: string
    // direction: "backwards" | "forwards"
}

// type TextTarget = {
//     pattern: string
//     antiPattern?: string
//     direction: "backwards" | "forwards"
// }

type Target = NodeTarget | TextTarget

type TextDirection = "backwards" | "forwards"
type NodeDirection = "backwards" | "forwards" | "smart"
type OnSelect = "cut" | "copy" | { type: "replace" }
type TargetAndDirection = { target: TextTarget, direction: TextDirection } | { target: NodeTarget, direction: NodeDirection }

type Move = {
    action: "move"
    from: Source
} & TargetAndDirection

type Select = {
    action: "select"
    from: Source
    onSelect?: OnSelect
} & TargetAndDirection

type Extend = {
    action: "extend"
    from: Source
    target: Target
    onSelect?: OnSelect
}

type BidirectionalExtend = {
    action: "BidirectionalExtend"
    backwards: Target
    forwards: Target
    onSelect?: OnSelect
}

