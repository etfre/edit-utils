import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile, } from "./rpc"
import { setup } from "./ast"
import * as nodeLoader from "./nodeLoader";

export async function activate(context: vscode.ExtensionContext) {
    console.log(context.extensionUri);
    let langsRoot = context.asAbsolutePath("langs");
    await Promise.all([setup(), nodeLoader.initSubtypes(langsRoot)]);
    watchRPCInputFile();
    setInterval(watchRPCInputFile, 10000)
}

export async function deactivate() {
    shutdown()
}
