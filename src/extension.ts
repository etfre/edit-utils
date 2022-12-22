import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile, } from "./rpc"
import { setup } from "./ast"

export async function activate(context: vscode.ExtensionContext) {
    await setup()
    watchRPCInputFile();
    setInterval(watchRPCInputFile, 10000)
}

export async function deactivate() {
    shutdown()

}
