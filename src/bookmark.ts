import * as vscode from "vscode";

const activeBookmarks = new Map<string, Bookmark[]>()

export function setupBookmarkEvents() {
    const disposables: vscode.Disposable[] = []
    disposables.push(vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
        const uri = event.document.uri.toString();
        event.contentChanges
        for (const change of event.contentChanges) {
            console.log(change.text, change.rangeLength, change.rangeOffset)
            // event.document.
            const newRange = new vscode.Range(1,2,3,4)
        }

    }))
    disposables.push(vscode.workspace.onDidCloseTextDocument((document) => {
        const uri = document.uri.toString();
        activeBookmarks.delete(uri);
    }))
    return disposables;
}

function reconcileContentChanges(bookmarks: Bookmark[], changes: readonly vscode.TextDocumentContentChangeEvent[]): Bookmark[] {
    const newBookmarks: Bookmark[] = []
    for (const bookmark of bookmarks) {
        let currentBookmark: Bookmark | null = bookmark
        for (const change of changes) {
            currentBookmark = reconcileContentChange(currentBookmark, change)
            if (currentBookmark === null) {
                break;
            }
        }
        if (currentBookmark !== null) {
            newBookmarks.push(currentBookmark);
        }
    }
    return newBookmarks
}

function reconcileContentChange(currentBookmark: Bookmark, change: vscode.TextDocumentContentChangeEvent): Bookmark | null {
    const bookmarkRange = currentBookmark.range;
    // bookmarkRange.
    change.rangeLength
    // if (change.range.end > bookmarkRange.start && change.range.end 
    throw new Error("")
}

class Bookmark {
    range: vscode.Range
    constructor(range: vscode.Range) {
        this.range = range;
    }
}

export function setBookmarkFromSelection(editor: vscode.TextEditor) {
    const uri = editor.document.uri.toString()
    const bookmarks = editor.selections.map(selection => new Bookmark(selection));
    activeBookmarks.set(uri, bookmarks);
    console.log(bookmarks)
}

export function focusAndSelectBookmarks(editor: vscode.TextEditor) {
    const uri = editor.document.uri.toString()
    const bookmarks = activeBookmarks.get(uri);
    if (!bookmarks) {
        console.log(`No bookmark active for ${uri}`)
        return;
    }
    const newSelections: vscode.Selection[] = []
    for (const bookmark of bookmarks) {
        const selection = bookmark.range instanceof vscode.Selection ? bookmark.range : new vscode.Selection(bookmark.range.start, bookmark.range.end);
        newSelections.push(selection);
    }
    if (newSelections.length > 0) {
        editor.selections = newSelections;
        editor.revealRange(newSelections[newSelections.length - 1], vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
}