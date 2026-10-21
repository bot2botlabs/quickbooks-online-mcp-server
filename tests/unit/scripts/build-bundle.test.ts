import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = resolve(process.cwd(), "scripts/build-bundle.mjs");

describe("build-bundle", () => {
  let fixtureRoot: string;

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("fails when dist/ is missing", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "qbo-build-bundle-"));
    writeFileSync(
      join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "0.0.0-test",
        dependencies: {},
      }),
    );
    writeFileSync(
      join(fixtureRoot, "manifest.json"),
      JSON.stringify({ name: "fixture", manifest_version: "0.4" }),
    );
    writeFileSync(join(fixtureRoot, "package-lock.json"), "{}\n");
    writeFileSync(join(fixtureRoot, "LICENSE"), "Apache-2.0\n");

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
  });
});
