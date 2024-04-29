import { check, transpile } from "../index.ts";
import fs from "node:fs";
import urlModule from "node:url";
import path from "node:path";

const load = async (url, context, nextLoad) => {

    if (url.endsWith(".ts")) {

        const parsedUrl = new urlModule.URL(url);
        if (parsedUrl.protocol !== "file:") {
            throw Error(`protocol not supported: ${parsedUrl.protocol}`);
        }

        const filename = parsedUrl.pathname;

        const code = await fs.promises.readFile(filename, "utf8");

        let source;

        try {
            source = await transpile({
                code,
                basename: path.basename(filename)
            })
        } catch (ex) {
            throw Error(`failed to transpile ${url}`, { cause: ex });
        }

        return {
            format: "module",
            source,
            shortCircuit: true
        }
    }

    return nextLoad(url);
};

export {
    load
};
