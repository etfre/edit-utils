export function sliceArray<T>(arr: T[], start: number, stop: number | null, step: number): Array<T> {
    if (stop === null) {
        stop = arr.length
    }
    const ret: T[] = []
    for (let i = start; i < stop; i += step) {
        ret.push(arr[i])
    }
    return ret
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