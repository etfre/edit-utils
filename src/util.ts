export function sliceArray<T>(arr: T[], start: number = 0, stop: number | null = null, step: number = 1): Array<T> {
    const sliced: T[] = []
    for (let idx of sliceIndices(arr, start, stop, step)) {
        sliced.push(arr[idx])
    }
    return sliced;
}

export function* sliceIndices(arr: any[], start: number, stop: number | null = null, step: number) {
    const arrLength = arr.length
    if (stop === null) stop = arrLength;
    else if (stop < 0) {
        stop = arrLength + stop
    }
    if (step === 0) {
        throw new Error("Step cannot be 0")
    }
    const isReverse = step < 0;
    if (!isReverse) {
        if (stop <= start) return;
        for (let i = start; i < stop; i += step) {
            yield i
        }
    }
    else {
        if (stop >= start) return;
        for (let i = start; i > stop; i += step) {
            yield i
        }
    }
}

export function range(start: number, stop: number, step = 1): number[] {

    return Array(Math.ceil((stop - start) / step)).fill(start).map((x, y) => x + y * step)
}

export function backwardsThroughZero(start: number) {
    const arr = []
    for (let i = start; i >= 0; i--) {
        arr.push(i)
    }
    return arr
}


export function assert(condition: boolean, message: string = "") {
    if (!condition) {
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