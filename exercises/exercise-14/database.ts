const readline = require('readline');
const fs = require('fs');

type QueryCriterion<T, K extends keyof T> = {
    $gt: T[K]
} | {
    $lt: T[K]
} | {
    $eq: T[K]
} | {
    $in: ReadonlyArray<T[K]>
}

type QueryCondition<T> = {
    [K in keyof T]?: QueryCriterion<T, K>
}

type Query<T> = QueryCondition<T> | {
    $and: ReadonlyArray<Query<T>>
} | {
    $or: ReadonlyArray<Query<T>>
} | {
    $text: string;
}

type Comparator<T> = (a: T, b: T) => number;

type Sort<T> = {
    [K in keyof T]?: 1 | -1;
}

type Projection<T> = {
    [K in keyof T]?: 1;
}

interface FindOptions<T> {
    sort?: Sort<T>;
    projection?: Projection<T>;
}

interface PipelineOperator<T extends object, R extends object> {
    readonly arr: T[];

    get(): R[];
}

class QueryChecker<T extends object> {

    constructor(protected readonly dbRecord: T,
                protected readonly query: Query<T>,
                protected readonly fullTextSearchFieldNames: (keyof T)[]) {
    }

    isOk(): boolean {
        if ('$and' in this.query) {
            return this.query.$and
                .every((subQuery: Query<T>) => new QueryChecker(this.dbRecord, subQuery, this.fullTextSearchFieldNames).isOk());
        }

        if ('$or' in this.query) {
            return this.query.$or
                .some((subQuery: Query<T>) => new QueryChecker(this.dbRecord, subQuery, this.fullTextSearchFieldNames).isOk());
        }

        if ('$text' in this.query) {
            const wordsToSearch: readonly string[] = this.extractWords(this.query.$text);
            const wordsToSearchIn: readonly string[][] = this.fullTextSearchFieldNames.map(
                (name: keyof T) => this.extractWords(String(this.dbRecord[name]))
            );

            return wordsToSearch.every((word: string) => wordsToSearchIn.some((words: string[]) => words.includes(word)));
        }

        const entries: [ keyof T, QueryCriterion<T, keyof T> ][] = Object.entries(this.query) as [ keyof T, QueryCriterion<T, keyof T> ][];

        return entries.every(([ key, criterion ]: [ keyof T, QueryCriterion<T, keyof T> ]) => this.checkCriterion(key, criterion));
    }

    // noinspection JSMethodCanBeStatic
    protected extractWords(text: string): string[] {
        return text.toLowerCase().split(' ');
    }

    protected checkCriterion<K extends keyof T>(key: K, criterion: QueryCriterion<T, K>): boolean {
        const valueToCheck: T[K] = this.dbRecord[key];

        if ('$in' in criterion) {
            return criterion.$in.some((value: T[K]) => value === valueToCheck);
        }

        if ('$gt' in criterion) {
            return criterion.$gt < valueToCheck;
        }

        if ('$lt' in criterion) {
            return criterion.$lt > valueToCheck;
        }

        return criterion.$eq === valueToCheck;
    }
}

class Filter<T extends object> implements PipelineOperator<T, T> {
    constructor(readonly arr: T[],
                protected readonly query: Query<T>,
                protected readonly fullTextSearchFieldNames: (keyof T)[]) {
    }

    get(): T[] {
        return this.arr.filter((elm: T): boolean => new QueryChecker(elm, this.query, this.fullTextSearchFieldNames).isOk());
    }
}

class Sorter<T extends object> implements PipelineOperator<T, T> {

    constructor(readonly arr: T[],
                readonly sort: Sort<T>) {
    }

    get(): T[] {
        const comparatorFactory = (key: keyof T, sorter: 1 | -1): Comparator<T> => (a: T, b: T): number => {
            if (typeof a[key] === 'number' && typeof b[key] === 'number') {
                return (Number(a[key]) - Number(b[key])) * sorter;
            }

            if (typeof a[key] === 'string' && typeof b[key] === 'string') {
                return sorter * String(a[key]).localeCompare(String(b[key]));
            }

            return 0;
        };
        const comparators: ReadonlyArray<Comparator<T>> = (Object.entries(this.sort) as [ keyof T, 1 | -1 ][])
            .map(([ key, sorter ]: [ keyof T, 1 | -1 ]) => comparatorFactory(key, sorter));

        return this.arr.sort((a: T, b: T): number => {
            for (let comparator of comparators) {
                const n: number = comparator(a, b);

                if (n !== 0) {
                    return n;
                }
            }

            return 0;
        });
    }
}

class Projector<T extends object> implements PipelineOperator<T, Partial<T>> {

    constructor(readonly arr: T[],
                protected readonly projector: Projection<T>) {
    }

    get(): Partial<T>[] {
        return this.arr.map((line: T): Partial<T> => {
            const projectionKeys: (keyof T)[] = Object.keys({ ...this.projector }) as (keyof T)[];
            const partial: Partial<T> = projectionKeys.reduce(
                (prev: Partial<T>, cur: keyof T): Partial<T> => ({ ...prev, [cur]: line[cur] }),
                {}
            );

            return partial;
        });
    }
}

export class Database<T extends object> {

    constructor(protected readonly filename: string,
                protected readonly fullTextSearchFieldNames: (keyof T)[]) {
    }

    async find(query: Query<T>, options?: FindOptions<T>): Promise<Partial<T>[]> {
        return new Promise<Partial<T>[]>((resolve, reject) => {
            try {
                let lines: T[] = [];

                const readInterface = readline.createInterface({
                    input: fs.createReadStream(this.filename)
                });

                readInterface.on('line', (line: string) => {
                    try {
                        if (this.isDeleted(line)) {
                            return;
                        }

                        const dbRecord: T = this.parseLine(line);

                        lines.push(dbRecord);
                    } catch (err) {
                        return reject(err);
                    }
                });

                readInterface.on('close', () => {
                    lines = [ ...new Filter(lines, query, this.fullTextSearchFieldNames).get() ];

                    if (options) {
                        if (!!options.sort) {
                            lines = [ ...new Sorter(lines, options.sort).get() ];
                        }

                        if (!!options.projection) {
                            return resolve([ ...new Projector(lines, options.projection).get() ]);
                        }
                    }

                    return resolve(lines);
                });
            } catch (err) {
                return reject(err);
            }
        });
    }

    // noinspection JSMethodCanBeStatic
    private isDeleted(line: string): boolean {
        return line.startsWith('D');
    }

    // noinspection JSMethodCanBeStatic
    private parseLine(line: string): T {
        return JSON.parse(line.substring(1));
    }

}
