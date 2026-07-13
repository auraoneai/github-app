const { readFileSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const pkg = require("../package.json");
const readme = readFileSync(join(root, "README.md"), "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

describe("package discovery contract", () => {
  test("keeps runtime behavior stable while exposing accurate npm metadata", () => {
    expect(pkg.name).toBe("@auraone/github-app");
    expect(pkg.main).toBe("src/app.js");
    expect(pkg.scripts.start).toBe("node src/app.js");
    expect(pkg.description).toContain("lifecycle-aware Check Run");
    expect(pkg.description).toContain("idempotent bot-owned PR summary");
    expect(pkg.description.length).toBeLessThanOrEqual(160);
    expect(pkg.engines).toEqual({ node: ">=18.0.0" });
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/auraoneai/github-app.git",
    });
    expect(pkg.homepage).toBe(
      "https://github.com/auraoneai/github-app#readme",
    );
    expect(pkg.bugs).toEqual({
      url: "https://github.com/auraoneai/github-app/issues",
    });

    for (const keyword of [
      "auraone",
      "github-app",
      "check-run",
      "pull-request-checks",
      "agent-evaluation",
      "llm-evaluation",
      "merge-gate",
      "self-hosted",
    ]) {
      expect(pkg.keywords).toContain(keyword);
    }
  });

  test("documents the required owner workflow and operating boundary", () => {
    for (const heading of [
      "The Job",
      "Who This Is For",
      "First Useful Workflow",
      "Self-Hosted Setup",
      "Permissions And Webhooks",
      "Runtime And Data Boundary",
      "Repository Config",
      "Remediation And Evidence",
      "Deployment And Release Proof",
      "Limitations",
      "Next Action",
    ]) {
      expect(readme).toContain(`## ${heading}`);
    }

    expect(readme).toContain("one lifecycle-aware GitHub Check");
    expect(readme).toContain("one idempotent bot-owned PR summary");
    expect(readme).toContain("`POST /api/github/webhooks`");
    expect(readme).toContain("| Checks | Read and write |");
    expect(readme).toContain("| Contents | Read |");
    expect(readme).toContain("| Pull requests | Read |");
    expect(readme).toContain("| Issues | Read and write |");
    expect(readme).toContain("`pull_request`");
    expect(readme).toContain("`check_run`");
    expect(readme).toContain("`push`");
    expect(readme).toContain("agent_bundle_url");
    expect(readme).toContain("no application database, durable queue");
    expect(readme).toContain(
      "version in `package.json` is not proof that the same",
    );
  });

  test("does not present unreleased source or an unverified app as deployed", () => {
    expect(changelog).toContain("## [Unreleased]");
    expect(changelog).toContain("## [0.2.0] - 2026-07-13");
    expect(changelog).toMatch(
      /This release is prepared in source\. Publication is recorded separately and is\s+not implied by this changelog entry\./,
    );
    expect(changelog).not.toMatch(/hosted version is available/i);
    expect(readme).not.toMatch(/install (?:our|the) public GitHub App/i);
    expect(readme).not.toMatch(
      /0\.2\.0 (?:is|was|has been) published to npm/i,
    );
  });
});
