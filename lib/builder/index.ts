import { TMaybeError } from "../util.ts";
// @ts-ignore
import { transpileCode as transpileToTSComments } from "commentscript";
import { analyzeImports } from "./import-analyzer.ts";
import path from "node:path";

type TReadFileResult = TMaybeError<{ content: string }>;
type TWriteFileResult = TMaybeError<{}>;
type TBuildResult = TMaybeError<{}>;
type TTransformResult = TMaybeError<{ transformedFilePath: string }>;

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

    let builtFiles: { [filePath: string]: { transformedFilePath: string } } = {};

    const transformTree = async ({ filePath, transpile }: { filePath: string, transpile: boolean }): Promise<TMaybeError<{ code: string }>> => {
        const readResult = await readInputFile({ filePath });
        if (readResult.error !== undefined) {
            return {
                error: readResult.error
            };
        }

        const content = readResult.content;

        let transpiledCode: string = content;

        if (transpile) {
            const transpileResult = await transpileToTSComments({ code: content }).then((result: any) => {
                return { error: undefined, transpiledCode: result.transpiledCode };
            }, (error: Error) => {
                return { error: error, transpiledCode: undefined };
            });

            if (transpileResult.error !== undefined) {
                return {
                    error: transpileResult.error
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

                const currentScriptDir = path.dirname(filePath);
                const referencedFilePath = path.join(currentScriptDir, imp.value);
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

                const transformedFilePath = buildResult.transformedFilePath;

                if (transformedFilePath !== normalizedPath) {
                    let pathToImport = path.relative(currentScriptDir, transformedFilePath);
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

    const maybeBuildTree = async ({ filePath }: { filePath: string }): Promise<TTransformResult> => {

        // if we already built the file, return the result
        const transformedFile = builtFiles[filePath];
        if (transformedFile !== undefined) {
            return {
                error: undefined,
                transformedFilePath: transformedFile.transformedFilePath
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
        const transformedFilePath = `${fileNameWithoutEnding}.js`;

        builtFiles = {
            ...builtFiles,
            [filePath]: {
                transformedFilePath
            }
        };

        const transformResult = await transformTree({ filePath, transpile });
        if (transformResult.error !== undefined) {
            return {
                error: transformResult.error
            };
        }

        const writeResult = await writeOutputFile({ filePath: transformedFilePath, content: transformResult.code });
        if (writeResult.error !== undefined) {
            return {
                error: writeResult.error
            };
        }

        return {
            error: undefined,
            transformedFilePath
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
