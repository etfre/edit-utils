import * as vscode from 'vscode';

import { watchFile, watch, writeFile, readFile, FSWatcher } from 'fs';
import { tmpdir, } from 'os';
import * as handlers from "./handlers"
import { sep, join } from 'path';
import { ClientRequest, ClientResponse, ClientResponseError, ClientResponseResult } from './types';

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share")
const fileRoot = join(appData, "corgi")

const RPC_INPUT_FILE = join(fileRoot, "speech-commands-input.json")
const RPC_OUTPUT_FILE = join(fileRoot, "speech-commands-output.json")

let inputFileWatcher: FSWatcher | null = null

const processedClientMessageIdsMaxSize = 10
const processedClientMessageIds: string[] = []

type handlerResponseType = Promise<ClientResponseResult | void> | (ClientResponseResult | void)
type handlerType = (editor: vscode.TextEditor, data: any) => handlerResponseType
type clientMessageHandlersType = {
    [type in ClientRequest['method']]: handlerType
}
const clientMessageHandlers: clientMessageHandlersType = {
    "GO_TO_LINE": handlers.handleGoToLine,
    "EXECUTE_COMMAND": handlers.handleExecuteCommand,
    "PING": handlers.handlePing,
    "SELECT_IN_SURROUND": handlers.handleSurroundAction,
    "SMART_ACTION": handlers.handleSmartAction,
    "SURROUND_INSERT": handlers.handleSurroundInsert,
    "EXECUTE_COMMANDS_PER_SELECTION": handlers.handleExecuteCommandsPerSelection,
    "SWAP": handlers.handleSwap,
    "SET_BOOKMARKS": handlers.handleSetBookmarks,
    "FOCUS_AND_SELECT_BOOKMARKS": handlers.handleFocusAndSelectBookmark,
}
export async function messageRPCClient(msg: ClientResponse | ClientResponse[]) {
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

async function handleClientMessage(msg: ClientRequest, editor: vscode.TextEditor) {
    const messageType = msg.method
    let errorMsg: string | null = null;
    let errorData: string | null = null;
    let result: any = null
    if (messageType in clientMessageHandlers) {
        const handler = clientMessageHandlers[messageType]
        try {
            result = await handler(editor, msg.params)
        }
        catch (e) {
            console.error((e as any).stack)
            errorMsg = "Handler error " + e;
        }
    }
    if (errorMsg !== null) {
        const error: ClientResponseError = { code: 0, message: errorMsg, data: errorData }
        const resp: ClientResponse = { jsonrpc: "2.0", error, id: msg.id }
        return resp;

    }
    else {
        const resp: ClientResponse = { jsonrpc: "2.0", result, id: msg.id }
        return resp;
        messageRPCClient(resp)
    }
}

async function handleRpcInputFileChange(path: string) {
    readFile(path, { encoding: 'utf-8' }, async (err, data) => {
        if (!err) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const responses: ClientResponse[] = []
            const clientMessage: ClientRequest | ClientRequest[] = JSON.parse(data);
            const isMultiple = Array.isArray(clientMessage);
            const clientMessages = isMultiple ? clientMessage : [clientMessage]
            for (const clientMsg of clientMessages) {
                const messageId = clientMsg.id
                if (processedClientMessageIds.includes(messageId)) {
                    return
                }
                processedClientMessageIds.push(messageId)
                if (processedClientMessageIds.length > processedClientMessageIdsMaxSize) {
                    processedClientMessageIds.shift()
                }
                const resp = await handleClientMessage(clientMsg, editor)
                responses.push(resp)
                messageRPCClient(resp)
            }
            if (isMultiple) {
                messageRPCClient(responses)
            }
            else {
                messageRPCClient(responses[0])
            }
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