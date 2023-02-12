import { readdir, readFile } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from 'url';

const SUBTYPES_BY_LANG: Map<string, { [node in string]: string[] }> = new Map();

export function initSubtypes(langsRoot: string) {
    const prom: Promise<void> = new Promise((resolve, reject) => {
        readdir(langsRoot, { withFileTypes: true }, (err, items) => {
            if (err !== null) {
                reject(err);
            }
            const langFolders = items.filter(x => x.isDirectory())
            for (const folder of langFolders) {
                const path = join(langsRoot, folder.name, "node-types.json");
                const lang = folder.name;
                readFile(path, { encoding: 'utf-8' }, async (err, data) => {
                    if (err) {
                        reject(err);
                    }
                    const langSubtypes = parseNodeTypes(JSON.parse(data));
                    SUBTYPES_BY_LANG.set(lang, langSubtypes);
                    console.log(`Loaded language: ${lang}`)
                    if (SUBTYPES_BY_LANG.size === langFolders.length) {
                        resolve();
                    }
                })
            }
        });
    });
    return prom;
}

function parseNodeTypes(nodeTypes: any[]): { [node in string]: string[] } {
    const result: { [node in string]: string[] } = {}
    for (const { type, subtypes } of nodeTypes) {
        if (subtypes) {
            result[type] = subtypes.filter((x: any) => x.named).map((x: any) => x.type);
        }
    }

    return result;
}

export function* yieldSubtypes(node: string, lang: string): Generator<string> {
    const nodeMap = SUBTYPES_BY_LANG.get(lang);
    if (nodeMap === undefined) {
        yield node;
        return;
    }
    const seen = new Set<string>();
    const stack = [node];
    while (stack.length > 0) {
        const curr = stack.pop() as string;
        yield curr;
        const currSubtypes = nodeMap[curr] ?? [];
        for (const subType of currSubtypes) {
            if (!seen.has(subType)) {
                stack.push(subType);
                seen.add(subType);
            }
        }
    }
}