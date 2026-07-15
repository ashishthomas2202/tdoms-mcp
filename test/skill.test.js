import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CAPABILITY_IDS, OPTION_SETS } from "../src/capability-registry.js";

const skillRoot = fileURLToPath(new URL("../skills/tdoms-mcp-routing", import.meta.url));
const skillPath = path.join(skillRoot, "SKILL.md");
const referencePaths = [
  "references/workflow-playbooks.md",
  "references/tool-and-extension-map.md",
  "references/tdoms-domain-and-sources.md"
].map((relativePath) => path.join(skillRoot, relativePath));

test("TD/OMS skill covers the current capability and option registries", () => {
  const documentation = [skillPath, ...referencePaths]
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");

  for (const capabilityId of CAPABILITY_IDS) {
    assert.ok(documentation.includes(`\`${capabilityId}\``), `Document capability ${capabilityId}`);
  }
  for (const optionSet of OPTION_SETS) {
    assert.ok(documentation.includes(`\`${optionSet}\``), `Document option set ${optionSet}`);
  }
});

test("TD/OMS skill references exist and contain no machine-specific user paths", () => {
  const skill = fs.readFileSync(skillPath, "utf8");
  for (const referencePath of referencePaths) {
    assert.ok(fs.existsSync(referencePath), `${referencePath} should exist`);
  }

  const documentation = [skillPath, ...referencePaths]
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
  assert.doesNotMatch(documentation, /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\s/]+/);
  assert.doesNotMatch(documentation, /(?:password|token|jwt|master[_ -]?key)\s*[:=]\s*\S+/i);
});
