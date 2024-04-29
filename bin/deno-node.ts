#!/usr/bin/env node

import child_process from "node:child_process";
import process from "node:process";
// @ts-ignore
import { resolve } from "esm-resource";
import fs from "fs";
import { check } from "../lib/index.ts";

let nodeArgs : string[] = [];
let entryFile: string | undefined = undefined;
let args : string[] = [];
let checkCode = true;

process.argv.slice(2).forEach((arg) => {
    if (entryFile === undefined) {
        if (arg === "--no-check") {
            checkCode = false;
        } else if (arg.startsWith("--")) {
            nodeArgs = [
                ...nodeArgs,
                arg
            ];
        } else {
            entryFile = arg;
        }
    } else {
        args = [
            ...args,
            arg
        ];
    }
});

if (entryFile === undefined) {
    console.error("entry file not specified");
    process.exitCode = -1;
    process.exit();
}

if (fs.existsSync(entryFile)) {

    let errors : string[] = [];

    if (checkCode) {
        const checkResult = await check({ filename: entryFile });
        errors = checkResult.errors;
    }

    if (errors.length > 0) {
        console.error("typescript errors:");

        errors.forEach((error) => {
            console.error(error);
        });

        process.exitCode = -1;
    } else {
        const proc = child_process.spawn(process.execPath, [
            ...nodeArgs,
            "--import", resolve({ importMeta: import.meta, filepath: "../lib/loader/preload.js" }),
            entryFile,
            ...args
        ], {
            stdio: "inherit"
        });

        proc.on("error", (error) => {
            console.error(error);
            process.exitCode = -1;
        })

        proc.on("exit", (code, signal) => {
            if (code !== null) {
                process.exitCode = code;
            } else {
                console.error(`process terminated with signal ${signal}`);
                process.exitCode = -1;
            }
        });
    }
} else {
    console.error(`file not found: ${entryFile}`);
    process.exitCode = -1;
}
