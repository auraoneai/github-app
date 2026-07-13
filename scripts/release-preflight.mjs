#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const expectedTag =
  process.argv[2] || process.env.GITHUB_REF_NAME || `v${pkg.version}`;

if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.test(
    pkg.version,
  )
) {
  throw new Error(`package version is not semantic: ${pkg.version}`);
}
if (expectedTag !== `v${pkg.version}`) {
  throw new Error(
    `tag ${expectedTag} must match package version v${pkg.version}`,
  );
}
if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
  throw new Error("package.json and package-lock.json versions must match");
}
if (pkg.name !== "@auraone/github-app") {
  throw new Error("package name must remain @auraone/github-app");
}
if (
  pkg.publishConfig?.access !== "public" ||
  pkg.publishConfig?.provenance !== true
) {
  throw new Error("publishConfig must require public access and provenance");
}
if (process.env.GITHUB_ACTIONS === "true") {
  const head = execFileSync("git", ["rev-parse", "HEAD^{commit}"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tagCommit = execFileSync("git", ["rev-parse", `${expectedTag}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (head !== tagCommit) {
    throw new Error(
      `checked-out commit ${head} does not match ${expectedTag} (${tagCommit})`,
    );
  }
}

execFileSync("npm", ["run", "lint"], { cwd: root, stdio: "inherit" });
execFileSync("npm", ["test", "--", "--runInBand"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("npm", ["audit", "--omit=dev"], {
  cwd: root,
  stdio: "inherit",
});

const packDir = mkdtempSync(join(tmpdir(), "auraone-github-app-pack-"));
try {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir],
    { cwd: root, encoding: "utf8" },
  );
  const [{ files = [] }] = JSON.parse(output);
  const paths = new Set(files.map((entry) => entry.path));
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "src/app.js",
  ]) {
    if (!paths.has(required)) {
      throw new Error(`packed package is missing ${required}`);
    }
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

console.log(`release preflight passed for ${pkg.name} ${pkg.version}`);
