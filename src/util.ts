import * as vscode from "vscode";

export function sliceArray<T>(arr: T[], start: number = 0, stop: number | null = null, step: number = 1): Array<T> {
    const sliced: T[] = []
    for (let idx of sliceIndices(arr.length, start, stop, step)) {
        assert(idx >= 0 && idx < arr.length)
        sliced.push(arr[idx])
    }
    return sliced;
}

function adjust_endpoint(length: number, endpoint: number, step: number) {
    if (endpoint < 0) {
        endpoint += length
        if (endpoint < 0) {
            endpoint = step < 0 ? -1 : 0
        }
    }
    else if (endpoint >= length) {
        endpoint = step < 0 ? length - 1 : length
    }
    return endpoint
}

function adjust_slice(length: number, start: number, stop: number | null, step: number) {
    assert(step != 0)
    start = adjust_endpoint(length, start, step)
    if (stop === null) {
        stop = step < 0 ? -1 : length
    }
    else {
        stop = adjust_endpoint(length, stop, step)
    }
    return [start, stop, step]
}

export function* sliceIndices(length: number, start: number, stop: number | null, step: number) {
    [start, stop, step] = adjust_slice(length, start, stop, step)
    let i = start
    while (step < 0 ? (i > stop) : (i < stop)) {
        yield i
        i += step
    }
}


export function assert(condition: boolean, message: string = ""): asserts condition {
    if (condition === false) {
        throw new Error(message);
    }
}

export function reversed<T>(array: T[]): T[] {
    return [...array].reverse();
}

export function isNullish(x: any): x is (null | undefined) {
    return x === null || x === undefined;
}

export function assertIsDefined<T>(val: T): asserts val is NonNullable<T> {
    if (val === undefined || val === null) {
        throw new Error(
            `Expected 'val' to be defined, but received ${val}`
        );
    }
}

export function assertIsNullish(val: any): asserts val is null | undefined {
    if (val !== undefined && val !== null) {
        throw new Error(
            `Expected 'val' to be nullish, but received ${val}`
        );
    }
}

export function* mergeGenerators<T>(...generators: Generator<T>[]) {
    for (const gen of generators) {
        yield* gen
    }
}

export function unEscapeRegex(escaped: string) {
    return escaped.replace(/\\(.)/g, '$1');
}

export function ensureSelection(val: vscode.Range | vscode.Position): vscode.Selection {
    const isValSelection = isSelection(val)
    if (isValSelection) {
        return val
    }
    if (val instanceof vscode.Range) {
        return new vscode.Selection(val.start, val.end)
    }
    return new vscode.Selection(val, val);
}

export function isSelection(val: vscode.Range | vscode.Position): val is vscode.Selection {
    return "anchor" in val;
}

export function shrinkSelection(selection: vscode.Selection, startLength: number, endLength: number): vscode.Selection {
    const start = selection.start.translate(0, -startLength);
    const end = selection.end.translate(0, endLength);
    assert(start.isBeforeOrEqual(end))
    const isReverse = selection.active.isBefore(selection.anchor);
    const [anchor, active] = isReverse ? [end, start] : [start, end]
    return new vscode.Selection(anchor, active)
}