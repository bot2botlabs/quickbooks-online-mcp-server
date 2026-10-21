import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const stagingDir = join(root, ".mcpb-build");
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const outputPath = join(
  root,
  `quickbooks-online-mcp-server-${packageJson.version}.mcpb`,
);

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
};

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

for (const file of [
  "manifest.json",
  "package.json",
  "package-lock.json",
  "LICENSE",
]) {
  cpSync(join(root, file), join(stagingDir, file));
}
cpSync(join(root, "dist"), join(stagingDir, "dist"), { recursive: true });

// Lifecycle scripts need the development toolchain; bundles only need runtime deps.
const stagedPackageJson = { ...packageJson, scripts: {} };
writeFileSync(
  join(stagingDir, "package.json"),
  `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
);
run(
  "npm",
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  stagingDir,
);

const runtimePackageJson = { ...stagedPackageJson };
delete runtimePackageJson.devDependencies;
writeFileSync(
  join(stagingDir, "package.json"),
  `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
);

const mcpbBinary = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "mcpb.cmd" : "mcpb",
);
run(mcpbBinary, ["validate", join(stagingDir, "manifest.json")]);
run(mcpbBinary, ["pack", stagingDir, outputPath]);
rmSync(stagingDir, { recursive: true, force: true });

console.log(`Created ${outputPath}`);
