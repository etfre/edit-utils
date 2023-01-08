import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile, } from "./rpc"
import { setup } from "./ast"
import * as nodeLoader from "./nodeLoader";

export async function activate(context: vscode.ExtensionContext) {
    console.log(context.extensionUri);
    const extensionRoot = context.extensionPath;
    await Promise.all([setup(), nodeLoader.initSubtypes(extensionRoot)]);
    watchRPCInputFile();
    setInterval(watchRPCInputFile, 10000)
}

export async function deactivate() {
    shutdown()

}
