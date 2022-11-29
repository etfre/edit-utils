import * as vscode from 'vscode';
import { watchFile, watch, writeFile, readFile, FSWatcher } from 'fs';
import { tmpdir } from 'os';
import * as handlers from "./handlers"
import { sep, join } from 'path';

const RPC_INPUT_FILE = tmpdir() + sep + "speech-commands-input.json"
const RPC_OUTPUT_FILE = tmpdir() + sep + "speech-commands-output.json"

let inputFileWatcher: FSWatcher | null = null

const processedClientMessageIdsMaxSize = 10
const processedClientMessageIds: string[] = []

type handlerResponseType = Promise<ClientResponseResult | void> | (ClientResponseResult | void)
type handlerType = (editor: vscode.TextEditor, data: any) => handlerResponseType
type clientMessageHandlersType = {
    [type in ClientRequest['method']]: handlerType
}
const clientMessageHandlers: clientMessageHandlersType = {
    "PING": handlers.handlePing,
    "SELECT_UNTIL_PATTERN": handlers.handleSelectUntilPattern,
    "SELECT_IN_SURROUND": handlers.handleSelectInSurround,
    "GET_ACTIVE_DOCUMENT": handlers.handleGetActiveDocument,
}

export async function messageRPCClient(msg: ClientResponse) {
    const messageStr = JSON.stringify(msg)
    const prom = new Promise<void>((resolve, reject) => {
        try {
            writeFile(RPC_OUTPUT_FILE, messageStr, {}, () => resolve())
        }
        catch (e) {
            reject(e)
        }
    })
    return prom;
}


export function watchRPCInputFile() {
    const path = RPC_INPUT_FILE
    try {
        if (inputFileWatcher === null) {
            inputFileWatcher = watch(path, { persistent: true }, () => handleRpcInputFileChange(path))
            console.log("inputFileWatcher init")
        }
    }
    catch (e) {
        console.log(e)
        if (inputFileWatcher !== null) {
            inputFileWatcher.close()
        }
        inputFileWatcher = null;
    }
}

async function handleClientMessage(msg: ClientRequest) {
    const messageType = msg.method
    let errorMsg: string | null = null;
    let errorData: string | null = null;
    let result: any = null
    if (messageType in clientMessageHandlers) {
        const handler = clientMessageHandlers[messageType]
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            try {
                result = await handler(editor, msg.params)
            }
            catch (e) {
                errorMsg = "Handler error " + e;
            }
        }
        else {
            errorMsg = "No editor open"
        }
    }
    if (errorMsg !== null) {
        const error: ClientResponseError = { code: 0, message: errorMsg, data: errorData }
        const resp: ClientResponse = { jsonrpc: "2.0", error, id: msg.id }
        messageRPCClient(resp)
    }
    else {
        const resp: ClientResponse = { jsonrpc: "2.0", result, id: msg.id }
        messageRPCClient(resp)
    }
}

async function handleRpcInputFileChange(path: string) {
    readFile(path, { encoding: 'utf-8' }, function (err, data) {
        if (!err) {
            const clientMsg: ClientRequest = JSON.parse(data);
            const messageId = clientMsg.id
            if (processedClientMessageIds.includes(messageId)) {
                return
            }
            processedClientMessageIds.push(messageId)
            if (processedClientMessageIds.length > processedClientMessageIdsMaxSize) {
                processedClientMessageIds.shift()
            }
            handleClientMessage(clientMsg)
            console.log('received data: ' + data);
        }
        else {
            console.log(err);
        }
    });
}

export function shutdown() {
    if (inputFileWatcher !== null) {
        inputFileWatcher.close()
    }
}