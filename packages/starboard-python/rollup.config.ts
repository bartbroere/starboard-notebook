import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "rollup-plugin-typescript2";
import dts from "rollup-plugin-dts";
import { string } from "rollup-plugin-string";
import { terser } from "rollup-plugin-terser";

const CleanCSS = require("clean-css");

// We need to be quite careful with these, when minifying and mangling everything there are clashes
// with `const e=` being in the same scope multiple times. Perhaps it's due to `importScripts` and its scoping?
const terserOptions = {
  ecma: 2020,
  keep_fnames: true,
  keep_classnames: true,
  ie8: false,
  safari10: true,
  compress: {
    defaults: false,
    booleans: true,
  },
  mangle: false,
  module: false,
};

// Inline plugin to load css as minified string
const css = () => {
  return {
    name: "css",
    transform(code, id) {
      if (id.endsWith(".css")) {
        const minified = new CleanCSS({ level: 2 }).minify(code);
        return `export default ${JSON.stringify(minified.styles)}`;
      }
    },
  };
};

// Stub Node.js built-ins so they don't become external ES-module `import`
// statements in the browser bundle (pyodide.asm.js references them).
const stubNodeBuiltins = () => ({
  name: "stub-node-builtins",
  resolveId(id) {
    const bare = id.startsWith("node:") ? id.slice(5) : id;
    const builtins = ["fs","path","crypto","child_process","os","util",
      "stream","events","buffer","url","http","https","net","tls","zlib","assert"];
    if (builtins.includes(bare)) return "\0stub:" + bare;
    return null;
  },
  load(id) {
    if (id.startsWith("\0stub:")) return "export default {}; export const readFileSync=()=>null; export const existsSync=()=>false; export const join=(...a)=>a.join('/');";
    return null;
  },
});

export default [
  {
    input: `src/worker/kernel.ts`,
    output: [{ file: "dist/kernel.js", format: "es" }],

    plugins: [
      resolve({ browser: true }),
      typescript({
        tsconfig: "./src/worker/tsconfig.json",
        include: ["./src/**/*.ts"],
      }),
      commonjs(),
      terser(terserOptions),
    ],
  },
  {
    input: `src/worker/pyodide-worker.ts`,
    output: [{ file: "dist/pyodide-worker.js", format: "es" }],
    inlineDynamicImports: true,
    plugins: [
      stubNodeBuiltins(),
      resolve({ browser: true }),
      typescript({
        tsconfig: "./src/worker/tsconfig.json",
        include: ["./src/**/*.ts"],
      }),
      commonjs(),
      terser(terserOptions),
    ],
  },
  {
    input: `src/index.ts`,
    output: [{ file: "dist/starboardPython.js", format: "es" }],
    plugins: [
      resolve({ browser: true }),
      typescript({
        include: ["./src/**/*.ts"],
      }),
      string({
        include: ["dist/kernel.js", "dist/pyodide-worker.js"],
      }),
      commonjs(),
      css(),
    ],
  },
  {
    input: `src/index.ts`,
    output: [{ file: "dist/starboardPython.d.ts", format: "es" }],
    plugins: [dts()],
  },
];
