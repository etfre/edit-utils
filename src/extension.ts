import * as vscode from 'vscode';
import { shutdown, watchRPCInputFile, } from "./rpc"
import { setup } from "./ast"
import * as nodeLoader from "./nodeLoader";
import { setupBookmarkEvents } from './bookmark';

const disposables: vscode.Disposable[] = []

export async function activate(context: vscode.ExtensionContext) {
    for (const disposable of setupBookmarkEvents()) {
        disposables.push(disposable)
    }
    let langsRoot = context.asAbsolutePath("langs");
    await Promise.all([setup(), nodeLoader.initSubtypes(langsRoot)]);
    watchRPCInputFile();
    setInterval(watchRPCInputFile, 10000)
}

export async function deactivate() {
    for (const disposable of disposables) {
        disposable.dispose()
    }
    shutdown()
}
