import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

// @ts-ignore
import { transpileCode as transpileToTSComments } from "commentscript";
import typescript from "typescript";

import type { Stats } from "node:fs";

const compilerOptions = {
    allowImportingTsExtensions: true,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeNext,
    target: typescript.ScriptTarget.ESNext,
    inlineSourceMap: true,
    // strict: true,
    // checkJs: true,
    allowJs: true,
};

const check = async ({ filename }: { filename: string }) => {
    const program = typescript.createProgram([filename], {
        ...compilerOptions,
        noEmit: true
    });

    program.emit();
    const diagnostics = typescript.getPreEmitDiagnostics(program);

    let errors: string[] = [];

    diagnostics.forEach((diagnostic) => {
        if (diagnostic.file) {
            let { line, character } = typescript.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
            let message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

            errors = [
                ...errors,
                `${diagnostic.file.fileName}: (${line + 1},${character + 1}): ${message}`
            ];
        } else {
            errors = [
                ...errors,
                typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
            ];
        }
    });

    return {
        errors
    };
};

const homeDir = os.homedir();
const cacheDir = path.join(homeDir, ".cache", "deno-node", "transpiled");

let cacheAvailable = false;

interface ICacheFile {
    filename: string;
    st: Stats;
}

const removeOldCacheFiles = async () => {
    const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true });

    let cacheFiles: ICacheFile[] = [];

    for (const entry of entries) {
        if (!entry.isFile()) {
            // someone put something else than a file in there, not our problem
            continue;
        }

        const filename = path.join(cacheDir, entry.name);
        const st = await fs.promises.stat(filename);

        cacheFiles = [
            ...cacheFiles,
            { filename, st }
        ];
    }

    // sort cache files by mtime, newest first
    cacheFiles.sort((a, b) => {
        return b.st.mtimeMs - a.st.mtimeMs;
    });

    let totalCacheSize = 0;
    cacheFiles.forEach(({ st }) => {
        totalCacheSize += st.size;
    });

    let filesToDelete: ICacheFile[] = [];

    if (totalCacheSize < 10 * 1024 * 1024) {
        // we have less than 10MB of cache files, don't delete anything

        filesToDelete = [];
    } else {
        filesToDelete = cacheFiles.slice(200).filter(({ st }) => {
            // always keep files younger than 10 minutes

            const tenMinutesAgo = Date.now() - 1000 * 60 * 10;
            return st.mtimeMs < tenMinutesAgo;
        });
    }

    for (const { filename } of filesToDelete) {
        await fs.promises.rm(filename, { force: true });
    }
};

try {
    if (process.env.DENO_NODE_DISABLE_CACHE) {
        cacheAvailable = false;
    } else {
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await removeOldCacheFiles();

        cacheAvailable = true;
    }
} catch (ex) {
    cacheAvailable = false;
}

const touch = async ({ filename }: { filename: string }) => {
    const touchHandle = await fs.promises.open(filename, "a");
    await touchHandle.close();
};

const transpile = async ({ code }: { code: string }) => {

    let cacheFile : string | undefined = undefined;

    if (cacheAvailable) {
        const hash = createHash('md5').update(code).digest('hex');
        cacheFile = path.join(cacheDir, hash);

        try {
            const transpiled = await fs.promises.readFile(cacheFile, "utf8");

            try {
                await touch({ filename: cacheFile });
            } catch (ex) {
                // ignore

                // if touching the cache file fails, we don't care
            }

            return transpiled;
        } catch (ex) {
            // ignore

            // if reading from cache fails, we'll just transpile
        }
    }

    const useCommentScript = true;

    let transpiled;

    if (useCommentScript) {
        const result = await transpileToTSComments({ code });
        transpiled = result.transpiledCode;
    } else {
        transpiled = typescript.transpile(code, {
            ...compilerOptions,
        });
    }

    if (cacheFile !== undefined) {
        await fs.promises.writeFile(cacheFile, transpiled, "utf8");
    }

    return transpiled;
};

export {
    check,
    transpile
};
