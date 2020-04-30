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

export class Database<T extends object> {

    constructor(protected readonly filename: string,
                protected readonly fullTextSearchFieldNames: (keyof T)[]) {
    }

    async find(query: Query<T>): Promise<T[]> {
        return new Promise<T[]>((resolve, reject) => {
            try {
                const filteredLines: T[] = [];

                const readInterface = readline.createInterface({
                    input: fs.createReadStream(this.filename)
                });

                readInterface.on('line', (line: string) => {
                    try {
                        if (this.isDeleted(line)) {
                            return;
                        }

                        const dbRecord: T = this.parseLine(line);
                        const queryChecker: QueryChecker<T> = new QueryChecker(dbRecord, query, this.fullTextSearchFieldNames);

                        if (queryChecker.isOk()) {
                            filteredLines.push(dbRecord);
                        }
                    } catch (err) {
                        reject(err);
                    }
                });

                readInterface.on('close', () => resolve(filteredLines));
            } catch (err) {
                reject(err);
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
