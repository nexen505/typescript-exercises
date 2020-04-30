declare module 'str-utils' {
    export type StringProcessor = (s: string) => string;
    
    export const strReverse: StringProcessor;
    export const strToLower: StringProcessor;
    export const strToUpper: StringProcessor;
    export const strRandomize: StringProcessor;
    export const strInvertCase: StringProcessor;
}
