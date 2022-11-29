
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
type GetActiveDocumentRequest = RequestBase & {
    method: "GET_ACTIVE_DOCUMENT"
}


type ClientRequest = PingRequest | SelectUntilPatternRequest | GetActiveDocumentRequest

type ClientResponseResult = JSONValue

type ClientResponseError = {
    code: number
    message: string
    data?: JSONValue
}

type ClientResponse = { jsonrpc: "2.0", id: string } & ({ result: ClientResponseResult } | { error: ClientResponseError })