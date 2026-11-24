#!/usr/bin/env node
/* Verify one work-unit result by recomputing it. Usage: node tools/verify_unit.js result.json   (or: echo '{...}' | node tools/verify_unit.js -)
   Exit code 0 = the result is exactly what the recomputation gives; 1 = it is not. */
const fs = require("fs"), path = require("path"), C = require(path.join(__dirname, "../web/contribute/core.js"));
const arg = process.argv[2]; if (!arg) { console.error("usage: node tools/verify_unit.js result.json|-"); process.exit(2); }
let r; try { r = JSON.parse(fs.readFileSync(arg === "-" ? 0 : arg, "utf8")); } catch (e) { console.error("not valid JSON:", e.message); process.exit(1); }
const v = C.verify(r); console.log(v.ok ? `OK: unit ${r.cell}-${r.block} reproduces exactly` : `REJECTED: ${v.reason}`); process.exit(v.ok ? 0 : 1);
