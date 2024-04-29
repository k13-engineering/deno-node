import module from "node:module";
module.register("./deno-loader.js", import.meta.url);
