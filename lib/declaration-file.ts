import typescript from "typescript";

import type { TMaybeError } from "./util.ts";

const generate = ({ code }: { code: string }): Promise<TMaybeError<{ declaration: string }>> => {

    const virtualFileName = "index.ts";
    const sourceFile = typescript.createSourceFile(virtualFileName, code, typescript.ScriptTarget.ESNext, true);

    const program = typescript.createProgram([virtualFileName], {
        allowImportingTsExtensions: true,
        module: typescript.ModuleKind.NodeNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeNext,
        target: typescript.ScriptTarget.ESNext,
        allowJs: true,
        declaration: true,
        emitDeclarationOnly: true,
        noEmitOnError: false,
    }, {
        fileExists: (filePath) => {
            return filePath === virtualFileName;
        },
        getCanonicalFileName: (fileName) => {
            return fileName;
        },
        getCurrentDirectory: () => {
            return "";
        },
        getDefaultLibFileName: () => {
            return "lib.d.ts";
        },
        getNewLine: () => {
            return "\n";
        },
        getSourceFile: (filePath) => {
            return filePath === virtualFileName ? sourceFile : undefined;
        },
        readFile: (filePath) => {
            return filePath === virtualFileName ? code : undefined;
        },
        useCaseSensitiveFileNames: () => {
            return true;
        },
        writeFile: (name, text) => {
            // unused
        },
        getDirectories: () => []
    });

    let result: string | undefined = undefined;

    const emitResult = program.emit(sourceFile, (fileName, text) => {
        if (fileName !== "index.d.ts") {
            throw Error("BUG: unexpected filename from typescript");
        }

        result = text;
    });

    if (emitResult.diagnostics.length > 0) {
        console.error(emitResult.diagnostics);
    }

    if (result === undefined) {
        if (emitResult.diagnostics.length > 0) {
            const diagnosticMessages = emitResult.diagnostics.map((diagnostic) => {
                if (diagnostic.file) {
                    let { line, character } = typescript.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
                    let message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
       
                    return `line ${line + 1}: ${message}`;
                } else {
                    return typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
                }
            });

            return Promise.resolve({
                error: Error(`failed to generate declaration file:\n\n${diagnosticMessages.join("\n")}`),
                declaration: undefined,
            });
        }

        throw Error("BUG: no result from typescript");
    }

    return Promise.resolve({
        error: undefined,
        declaration: result,
    });
};

export {
    generate
};
