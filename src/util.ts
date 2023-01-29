export function sliceArray<T>(arr: T[], start: number = 0, stop: number | null = null, step: number = 1): Array<T> {
    const sliced: T[] = []
    for (let idx of sliceIndices(arr, start, stop, step)) {
        assert(idx >= 0 && idx <= arr.length)
        sliced.push(arr[idx])
    }
    return sliced;
}

export function* sliceIndices(arr: any[], start: number, stop: number | null = null, step: number) {
    if (step === 0) {
        throw new Error("Step cannot be 0")
    }
    const isForward = step > 0;
    const arrLength = arr.length
    if (start < 0) {
        start = arrLength + start;
    }
    if (stop === null) {
        stop = isForward ? Infinity : -Infinity
    }
    else if (stop < 0) {
        stop = arrLength + stop
    }
    if (isForward) {
        stop = Math.min(arrLength, stop)
    }
    else {
        stop = Math.max(-1, stop);
    }
    if (isForward) {
        for (let i = start; i < stop; i += step) {
            assert(i >= 0 && i <= arrLength)
            yield i
        }
    }
    else {
        for (let i = start; i > stop; i += step) {
            assert(i >= 0 && i <= arrLength)
            yield i
        }
    }
}


// export function range(start: number, stop: number, step = 1): number[] {

//     return Array(Math.ceil((stop - start) / step)).fill(start).map((x, y) => x + y * step)
// }

export function backwardsThroughZero(start: number) {
    const arr = []
    for (let i = start; i >= 0; i--) {
        arr.push(i)
    }
    return arr
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