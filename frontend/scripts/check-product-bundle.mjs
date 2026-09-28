import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist-product");
const budget = JSON.parse(fs.readFileSync(path.join(root, "bundle-budgets.json"), "utf8"));

if (!fs.existsSync(dist)) {
  throw new Error("Product bundle is missing; run npm run build:product first");
}

const assets = fs.readdirSync(path.join(dist, "assets"), { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => {
    const file = path.join(dist, "assets", entry.name);
    return { name: entry.name, bytes: fs.statSync(file).size };
  });

const javascript = assets.filter(asset => asset.name.endsWith(".js"));
const css = assets.filter(asset => asset.name.endsWith(".css"));
const totalJavascript = javascript.reduce((sum, asset) => sum + asset.bytes, 0);
const largestJavascript = Math.max(0, ...javascript.map(asset => asset.bytes));

const failures = [];
if (totalJavascript > budget.totalJavascriptBytes) {
  failures.push(`total JavaScript ${totalJavascript} exceeds ${budget.totalJavascriptBytes}`);
}
if (largestJavascript > budget.largestJavascriptBytes) {
  failures.push(`largest JavaScript chunk ${largestJavascript} exceeds ${budget.largestJavascriptBytes}`);
}
if (css.reduce((sum, asset) => sum + asset.bytes, 0) > budget.totalCssBytes) {
  failures.push("total CSS exceeds configured budget");
}

console.log(JSON.stringify({
  totalJavascript,
  largestJavascript,
  totalCss: css.reduce((sum, asset) => sum + asset.bytes, 0),
  javascriptChunks: javascript.length,
  cssChunks: css.length,
  budgets: budget,
}, null, 2));

if (failures.length > 0) {
  console.error(`Product bundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
