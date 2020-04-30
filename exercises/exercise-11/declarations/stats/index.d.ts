declare module 'stats' {
    export type Comparator<T> = (a: T, b: T) => number;
    export type ValueExtractor<T> = (a: T) => number;

    export function getMaxIndex<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): number;
    export function getMaxElement<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): T | null;
    export function getMinIndex<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): number;
    export function getMinElement<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): T | null;
    export function getMedianIndex<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): number;
    export function getMedianElement<T>(input: ReadonlyArray<T>, comparator: Comparator<T>): T | null;
    export function getAverageValue<T>(input: ReadonlyArray<T>, extractor: ValueExtractor<T>): number;
}
