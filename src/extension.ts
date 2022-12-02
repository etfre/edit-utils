import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile } from "./rpc"


export function activate(context: vscode.ExtensionContext) {
    watchRPCInputFile()
}

export async function deactivate() {
    shutdown()

}
