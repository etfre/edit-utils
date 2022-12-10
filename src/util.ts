export function sliceArray<T>(arr: T[], start: number = 0, stop: number | null = null, step: number = 1): Array<T> {
    const sliced: T[] = []
    for (let idx of sliceIndices(arr, start, stop, step)) {
        sliced.push(arr[idx])
    }
    return sliced;
}

function* sliceIndices(arr: any[], start: number, stop: number | null = null, step: number) {
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