#!/usr/bin/env node

// @ts-ignore
import { create as createBuilder } from "../lib/builder/index.ts";
// @ts-ignore
import fs from "node:fs";
// @ts-ignore
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
// @ts-ignore
import process from "node:process";

const { argv } = yargs(hideBin(process.argv))
    .option("root", {
        type: "string",
        description: "The root directory of the project",
        requiresArg: true,
        demandOption: true
    })
    .option("out", {
        type: "string",
        description: "The output directory",
        requiresArg: true,
        demandOption: true
    })
    .option("entry", {
        type: "string",
        description: "The entry file",
        requiresArg: true,
        demandOption: true
    })
    .strict();

// @ts-ignore
if (Array.isArray(argv.root)) {
    console.error("root must only be specified once");
    process.exit(-1);
}

// @ts-ignore
if (Array.isArray(argv.out)) {
    console.error("out must only be specified once");
    process.exit(-1);
}

// @ts-ignore
const entryFilePaths = Array.isArray(argv.entry) ? argv.entry : [argv.entry];

// @ts-ignore
const buildRoot = argv.root;
// @ts-ignore
const outputDirectory = argv.out;

const builder = createBuilder({
    readInputFile: async ({ filePath }) => {
        const absoluteFilePath = path.join(buildRoot, filePath);
        return await fs.promises.readFile(absoluteFilePath, { encoding: "utf-8" }).then((content) => {
            return { error: undefined, content };
        }, (error) => {
            return { error: error as Error, content: undefined };
        });
    },

    writeOutputFile: async ({ filePath, content }) => {

        const absoluteFilePath = path.join(outputDirectory, filePath);
        const dir = path.dirname(absoluteFilePath);

        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(absoluteFilePath, content);

        return { error: undefined };
    }
});

for(const entryFilePath of entryFilePaths) {

    const relativeEntryFilePath = path.relative(buildRoot, entryFilePath);
    if (relativeEntryFilePath.startsWith("../")) {
        console.error(`entry file "${entryFilePath}" is outside of the project root`);
        process.exit(-1);
    }

    const { error } = await builder.build({ entryFilePath: relativeEntryFilePath });
    if (error !== undefined) {
        console.error("Error during build", { error });
        process.exit(-1);
    }
}
