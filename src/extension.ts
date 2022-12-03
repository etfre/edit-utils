import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile, } from "./rpc"
import { setup } from "./ast"

export async function activate(context: vscode.ExtensionContext) {
    await setup()
    watchRPCInputFile()
}

export async function deactivate() {
    shutdown()

}
