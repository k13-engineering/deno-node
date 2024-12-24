import estraverse from "estraverse";
import { parse as parseAst } from "@typescript-eslint/typescript-estree";
import type { TMaybeError } from "../util.ts";

interface IImportStatement {
    value: string;
    range: {
        from: number;
        to: number;
    };
};

interface IImportAnalyzeResult {
    imports: IImportStatement[];
};

type TImportAnalyzeReturn = TMaybeError<{ result: IImportAnalyzeResult }>;

const analyzeImports = ({ code }: { code: string }): TImportAnalyzeReturn => {
    try {
        const scriptAsAst = parseAst(code, {
            range: true
        });

        let imports: IImportStatement[] = [];

        // @ts-ignore
        estraverse.traverse(scriptAsAst, {
            enter: (node) => {
                if (node.type === "ImportDeclaration" && node.source.type === "Literal") {
                    imports = [
                        ...imports,
                        {
                            value: node.source.value as string,
                            range: {
                                from: node.source.range![0],
                                to: node.source.range![1]
                            }
                        }
                    ];
                    return;
                }

                if (node.type === "ExportAllDeclaration" && node.source.type === "Literal") {
                    imports = [
                        ...imports,
                        {
                            value: node.source.value as string,
                            range: {
                                from: node.source.range![0],
                                to: node.source.range![1]
                            }
                        }
                    ];
                    return;
                }
            },

            fallback: "iteration"
        });

        return {
            error: undefined,
            result: {
                imports
            }
        };
    } catch (ex) {
        return {
            error: ex as Error
        };
    }
};

export {
    analyzeImports
};

export type {
    IImportStatement,
    IImportAnalyzeResult,
    TImportAnalyzeReturn
};
