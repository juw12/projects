Pyodide 0.27.7 core files from the npm package `pyodide`, MPL-2.0 licensed.
Source: https://github.com/pyodide/pyodide - licence: https://www.mozilla.org/MPL/2.0/

Only the files a browser loads are kept here (pyodide.mjs, pyodide.asm.js, pyodide.asm.wasm,
python_stdlib.zip, pyodide-lock.json). The package's own package.json is left out on purpose:
it lists build tools that are never installed or run in this repo.
