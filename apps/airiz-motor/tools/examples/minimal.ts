import * as fs from "node:fs";
const out = "C:\Users\juwen_lie\Documents\Default Project\apps\airiz-motor\tools\examples\minimal-test.json";
fs.writeFileSync(out, JSON.stringify({hello: "world"}));
console.log("Wrote:", out);
