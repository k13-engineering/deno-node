import type { TMaybeError } from "../util.ts";
// @ts-ignore
import { transpileCode as transpileToTSComments } from "commentscript";
import { analyzeImports } from "./import-analyzer.ts";
import { generate as generateDeclarationFile } from "../declaration-file.ts";
// @ts-ignore
import path from "node:path";

type TReadFileResult = TMaybeError<{ content: string }>;
type TWriteFileResult = TMaybeError<{}>;
type TBuildResult = TMaybeError<{}>;

interface ITransformedFile {
    es6FilePath: string;
    declarationFilePath: string | undefined;
};
type TTransformResult = TMaybeError<{ transformed: ITransformedFile }>;

interface ICodeReplacement {
    replacement: string;
    range: {
        from: number;
        to: number;
    };
};

const rewriteCode = ({ code, replacements }: { code: string, replacements: ICodeReplacement[] }) => {

    const replacementsLastToFirst = replacements.slice().sort((a, b) => {
        return b.range.from - a.range.from;
    });

    let result = code;

    replacementsLastToFirst.forEach((replacement) => {
        const { from, to } = replacement.range;
        const before = result.substring(0, from);
        const after = result.substring(to);
        result = `${before}${replacement.replacement}${after}`;
    });

    return result;
};

const create = ({
    readInputFile,
    writeOutputFile
}: {
    readInputFile: ({ filePath }: { filePath: string }) => Promise<TReadFileResult>;
    writeOutputFile: ({ filePath, content }: { filePath: string, content: string }) => Promise<TWriteFileResult>;
}) => {

    let builtFiles: { [filePath: string]: ITransformedFile } = {};

    const transformTree = async ({ scriptDirectory, code, transpile }: { scriptDirectory: string, code: string, transpile: boolean }): Promise<TMaybeError<{ code: string }>> => {

        let transpiledCode: string = code;

        if (transpile) {
            const transpileResult = await transpileToTSComments({ code }).then((result: any) => {
                return { error: undefined, transpiledCode: result.transpiledCode };
            }, (error: Error) => {
                return { error: error, transpiledCode: undefined };
            });

            if (transpileResult.error !== undefined) {

                if (transpileResult.error.location !== undefined) {
                    const lines = code.split("\n");

                    const lineNumber = transpileResult.error.location.start.line;
                    const line = lines[lineNumber - 1];

                    return {
                        error: Error(`failed to transpile code, line number ${lineNumber}, line = "${line}"`, { cause: transpileResult.error })
                    };
                }

                return {
                    error: Error(`failed to transpile code`, { cause: transpileResult.error })
                };
            }

            transpiledCode = transpileResult.transpiledCode;
        }

        const analyzeResult = analyzeImports({ code: transpiledCode });
        if (analyzeResult.error !== undefined) {
            return {
                error: analyzeResult.error
            };
        }

        const imports = analyzeResult.result.imports;

        let replacements: ICodeReplacement[] = [];

        for (const imp of imports) {
            if (imp.value.startsWith("./") || imp.value.startsWith("../")) {
                const referencedFilePath = path.join(scriptDirectory, imp.value);
                const normalizedPath = path.normalize(referencedFilePath);

                if (normalizedPath.startsWith("../")) {
                    return {
                        error: Error(`relative import "${normalizedPath}" is outside of the project root`)
                    };
                }

                const buildResult = await maybeBuildTree({ filePath: normalizedPath });
                if (buildResult.error !== undefined) {
                    return {
                        error: buildResult.error
                    };
                }

                const transformedFilePath = buildResult.transformed.es6FilePath;

                if (transformedFilePath !== normalizedPath) {
                    let pathToImport = path.relative(scriptDirectory, transformedFilePath);
                    if (!pathToImport.startsWith("../")) {
                        pathToImport = `./${pathToImport}`;
                    }

                    replacements = [
                        ...replacements,
                        {
                            range: {
                                from: imp.range.from,
                                to: imp.range.to
                            },
                            replacement: `"${pathToImport}"`
                        }
                    ];
                }
            }
        }

        const finalCode = rewriteCode({ code: transpiledCode, replacements });

        return {
            error: undefined,
            code: finalCode
        };
    };

    const declarationTree = async ({ scriptDirectory, code }: { scriptDirectory: string, code: string }): Promise<TMaybeError<{ declaration: string }>> => {

        const declResult = await generateDeclarationFile({ code });
        if (declResult.error !== undefined) {
            return {
                error: declResult.error
            };
        }

        const analyzeResult = analyzeImports({ code: declResult.declaration });
        if (analyzeResult.error !== undefined) {
            return {
                error: analyzeResult.error
            };
        }

        const imports = analyzeResult.result.imports;
        let replacements: ICodeReplacement[] = [];

        for (const imp of imports) {
            if (imp.value.startsWith("./") || imp.value.startsWith("../")) {
                const referencedFilePath = path.join(scriptDirectory, imp.value);
                const normalizedPath = path.normalize(referencedFilePath);

                if (normalizedPath.startsWith("../")) {
                    return {
                        error: Error(`relative import "${normalizedPath}" is outside of the project root`)
                    };
                }

                const buildResult = await maybeBuildTree({ filePath: normalizedPath });
                if (buildResult.error !== undefined) {
                    return {
                        error: buildResult.error
                    };
                }

                const declarationFilePath = buildResult.transformed.declarationFilePath;
                if (declarationFilePath === undefined) {
                    return {
                        error: Error(`no declaration file for "${normalizedPath}"`)
                    };
                }

                // in declaration file, import the transpiled ES6 file
                // e.g. -> import { foo } from "./foo.ts" --> import { foo } from "./foo.js"

                // we cannot import the declaration file, as it gives errors in the TypeScript compiler

                let pathToImport = path.relative(scriptDirectory, buildResult.transformed.es6FilePath);
                if (!pathToImport.startsWith("../")) {
                    pathToImport = `./${pathToImport}`;
                }

                replacements = [
                    ...replacements,
                    {
                        range: {
                            from: imp.range.from,
                            to: imp.range.to
                        },
                        replacement: `"${pathToImport}"`
                    }
                ];
            }
        }

        const finalDeclaration = rewriteCode({ code: declResult.declaration, replacements });

        return {
            error: undefined,
            declaration: finalDeclaration
        };
    };

    const maybeBuildTree = async ({ filePath }: { filePath: string }): Promise<TTransformResult> => {

        // if we already built the file, return the result
        const transformedFile = builtFiles[filePath];
        if (transformedFile !== undefined) {
            return {
                error: undefined,
                transformed: transformedFile
            };
        }

        let transpile = false;
        const fileEndingHandlers: { [key: string]: () => void } = {
            ".ts": () => {
                transpile = true;
            },

            ".js": () => {
                transpile = false;
            },

            ".mjs": () => {
                transpile = false;
            }
        };

        const fileEnding = path.extname(filePath);
        const fileEndingHandler = fileEndingHandlers[fileEnding];
        if (fileEndingHandler === undefined) {
            return {
                error: Error(`unsupported file type: ${fileEnding}`)
            };
        }

        fileEndingHandler();

        const fileNameWithoutEnding = filePath.substring(0, filePath.length - fileEnding.length);
        const es6FilePath = `${fileNameWithoutEnding}.js`;
        const declarationFilePath = `${fileNameWithoutEnding}.d.ts`;
        const scriptDirectory = path.dirname(filePath);

        const result = {
            es6FilePath,
            declarationFilePath: transpile ? declarationFilePath : undefined
        };

        builtFiles = {
            ...builtFiles,
            [filePath]: result
        };

        const readResult = await readInputFile({ filePath });
        if (readResult.error !== undefined) {
            return {
                error: readResult.error
            };
        }

        const transformResult = await transformTree({
            scriptDirectory,
            code: readResult.content,
            transpile
        });
        if (transformResult.error !== undefined) {
            return {
                error: Error(`failed to transform tree of "${filePath}"`, { cause: transformResult.error })
            };
        }

        const writeResult = await writeOutputFile({
            filePath: es6FilePath,
            content: transformResult.code
        });
        if (writeResult.error !== undefined) {
            return {
                error: writeResult.error
            };
        }

        if (transpile) {

            const declResult = await declarationTree({ scriptDirectory, code: readResult.content });
            if (declResult.error !== undefined) {
                return {
                    error: declResult.error
                };
            }

            const writeDeclResult = await writeOutputFile({
                filePath: declarationFilePath,
                content: declResult.declaration
            });
            if (writeDeclResult.error !== undefined) {
                return {
                    error: writeDeclResult.error
                };
            }
        }

        return {
            error: undefined,
            transformed: result
        };
    };

    const build = async ({ entryFilePath }: { entryFilePath: string }): Promise<TBuildResult> => {
        const { error } = await maybeBuildTree({ filePath: entryFilePath });
        return { error };
    };

    return {
        build
    };
};

export {
    create
};
