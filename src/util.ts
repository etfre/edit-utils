export function sliceArray<T>(arr: T[], start: number, stop: number | null, step: number): Array<T> {
    if (stop === null) {
        stop = arr.length - 1
    }
    const ret: T[] = []
    for (let i = 0; i < stop; i += step) {
        ret.push(arr[i])
    }
    return ret
}