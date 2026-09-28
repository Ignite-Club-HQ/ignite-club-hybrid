import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "icp-domain-topology.json"), "utf8"));
const bindingsRoot = path.join(root, "frontend", "src", "lab", "generated-contracts");

function candidMethods(source) {
  const serviceStart = source.indexOf("service :");
  if (serviceStart < 0) throw new Error("Candid service declaration is missing");
  const service = source.slice(serviceStart);
  return new Set([...service.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\(/gm)].map(match => match[1]));
}

function generatedMethods(source) {
  const serviceStart = source.indexOf("export interface _SERVICE");
  if (serviceStart < 0) throw new Error("Generated _SERVICE declaration is missing");
  const service = source.slice(serviceStart);
  return new Set([...service.matchAll(/^\s{2}'([A-Za-z_][A-Za-z0-9_]*)'\s*:/gm)].map(match => match[1]));
}

for (const role of manifest.roles) {
  if (role.status === "planned" || role.status === "external_boundary") continue;
  const rolePath = path.join(root, role.path);
  const candidFile = fs.readdirSync(rolePath).find(file => file.endsWith(".did") && !file.startsWith("."));
  if (!candidFile) throw new Error(`Missing Candid contract for ${role.name}`);

  const declarationsDir = path.join(bindingsRoot, role.name, "declarations");
  if (!fs.existsSync(declarationsDir)) throw new Error(`Generated binding missing for ${role.name}`);
  const declaration = fs.readdirSync(declarationsDir).find(file => file.endsWith(".did.d.ts"));
  if (!declaration) throw new Error(`Generated declaration missing for ${role.name}: ${bindingDir}`);

  const candid = candidMethods(fs.readFileSync(path.join(rolePath, candidFile), "utf8"));
  const generated = generatedMethods(fs.readFileSync(path.join(declarationsDir, declaration), "utf8"));
  const missing = [...candid].filter(method => !generated.has(method));
  const extra = [...generated].filter(method => !candid.has(method));
  if (missing.length || extra.length) {
    throw new Error(
      `Candid drift for ${role.name}: missing generated methods [${missing.join(", ")}]; extra generated methods [${extra.join(", ")}]`,
    );
  }
}

console.log(`Candid drift check passed: ${manifest.roles.filter(role => !["planned", "external_boundary"].includes(role.status)).length} active contracts`);
