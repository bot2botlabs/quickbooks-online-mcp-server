import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = resolve(process.cwd(), "scripts/manifest-sync.mjs");
let fixtureRoot: string;

const writeTool = (
  fileName: string,
  exportName: string,
  name: string,
  description: string,
) => {
  writeFileSync(
    join(fixtureRoot, "src/tools", fileName),
    `const toolName = ${JSON.stringify(name)};\n` +
      `const toolDescription = ${JSON.stringify(description)};\n` +
      `export const ${exportName} = {\n` +
      "  name: toolName, description: toolDescription, schema: {}, handler: async () => ({})\n" +
      "};\n",
  );
};

const runSync = (...args: string[]) =>
  spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, ...args], {
    encoding: "utf8",
  });

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "qbo-manifest-sync-"));
  mkdirSync(join(fixtureRoot, "src/tools"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, "src/index.ts"),
    'import { ZebraTool } from "./tools/zebra.tool.js";\n' +
      'import { AlphaTool } from "./tools/alpha.tool.js";\n' +
      "RegisterTool(server, ZebraTool);\n" +
      "RegisterTool(server, AlphaTool);\n",
  );
  writeTool("zebra.tool.ts", "ZebraTool", "zebra", "Last alphabetically.");
  writeTool("alpha.tool.ts", "AlphaTool", "alpha", "First alphabetically.");
  writeFileSync(
    join(fixtureRoot, "manifest.json"),
    '{"name":"fixture","tools":[]}\n',
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("manifest-sync", () => {
  it("writes registered tool metadata in a stable order", () => {
    const result = runSync();
    expect(result.status).toBe(0);

    const manifest = JSON.parse(
      readFileSync(join(fixtureRoot, "manifest.json"), "utf8"),
    );
    expect(manifest.tools).toEqual([
      { name: "alpha", description: "First alphabetically." },
      { name: "zebra", description: "Last alphabetically." },
    ]);
  });

  it("fails check mode when source metadata drifts", () => {
    expect(runSync().status).toBe(0);
    writeTool("alpha.tool.ts", "AlphaTool", "alpha", "Changed description.");

    const result = runSync("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "manifest.json tool metadata is out of date",
    );
  });

  it("resolves concatenated tool description constants", () => {
    writeFileSync(
      join(fixtureRoot, "src/index.ts"),
      'import { ConcatTool } from "./tools/concat.tool.js";\n' +
        "RegisterTool(server, ConcatTool);\n",
    );
    writeFileSync(
      join(fixtureRoot, "src/tools/concat.tool.ts"),
      'const toolName = "concat";\n' +
        'const toolDescription = "part one. " + "part two.";\n' +
        "export const ConcatTool = {\n" +
        "  name: toolName, description: toolDescription, schema: {}, handler: async () => ({})\n" +
        "};\n",
    );

    const result = runSync();
    expect(result.status).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(fixtureRoot, "manifest.json"), "utf8"),
    );
    expect(manifest.tools).toEqual([
      { name: "concat", description: "part one. part two." },
    ]);
  });

  it("requires --root to include a directory path", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--root"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--root requires a directory");
  });
});
