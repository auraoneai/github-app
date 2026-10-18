/**
 * H7 regression detection: the GitHub App must compare pull request scores
 * against the base-branch score in addition to `pass_threshold`, fail with a
 * "regression" conclusion when a template drops below base, and stay
 * inconclusive (not failing) when the baseline cannot be produced.
 */

const WEBHOOK_SECRET = "regression-test-webhook-secret";

jest.mock("@octokit/app", () => {
  class FakeWebhooks {
    constructor({ secret }) {
      this.secret = secret;
    }
    on() {}
  }
  class FakeApp {
    constructor(options) {
      this.webhooks = new FakeWebhooks(options.webhooks);
    }
    async getInstallationOctokit() {
      return this._installationOctokit;
    }
  }
  return { App: FakeApp };
});

let mockScores;
const mockEvaluationCalls = [];
jest.mock(
  "@auraone/sdk",
  () => {
    class FakeAuraOneClient {
      constructor(config) {
        this.config = config;
        this.evaluations = {
          create: jest.fn(async ({ agent_bundle_url }) => {
            const base = String(agent_bundle_url).includes("baseaaa");
            mockEvaluationCalls.push(base ? "base" : "head");
            return {
              id: base ? "eval_base" : "eval_head",
              score: base ? mockScores.base : mockScores.head,
              status: "completed",
            };
          }),
        };
      }
      getBaseUrl() {
        return this.config.baseUrl;
      }
    }
    return { AuraOneClient: FakeAuraOneClient };
  },
  { virtual: true },
);

const AuraGitHubApp = require("../app");
const {
  compareResultsToBaseline,
  evaluationDecision,
  renderBaselineTable,
  normalizeRegressionTolerance,
} = require("../app");

const VALID_KEY = "ak_" + "1".repeat(8) + "_" + "a".repeat(64);

function makeApp() {
  return new AuraGitHubApp({
    appId: "1",
    privateKey: "k",
    webhookSecret: WEBHOOK_SECRET,
    auraApiKey: VALID_KEY,
    orgId: "org_1",
  });
}

function makeOctokit(configYaml, statuses) {
  return {
    rest: {
      repos: {
        createCommitStatus: jest.fn(async (status) => {
          statuses.push(status);
          return {};
        }),
        getContent: jest.fn(async () => ({
          data: {
            type: "file",
            content: Buffer.from(configYaml).toString("base64"),
          },
        })),
      },
      issues: { createComment: jest.fn(async () => ({})) },
    },
    auth: jest.fn(async () => ({ token: "inst-token" })),
  };
}

const repository = {
  name: "demo",
  full_name: "octo/demo",
  private: false,
  owner: { login: "octo" },
};

const pullRequest = {
  id: 7,
  number: 3,
  head: { sha: "deadbeef" },
  base: { sha: "baseaaa" },
};

describe("compareResultsToBaseline", () => {
  it("flags a template whose PR score drops below base beyond tolerance", () => {
    const comparison = compareResultsToBaseline(
      [{ template: "tpl-a", result: { score: 0.6, status: "completed" } }],
      [{ template: "tpl-a", result: { score: 0.8, status: "completed" } }],
      0,
    );
    expect(comparison.regressed).toBe(true);
    expect(comparison.regressedTemplates).toEqual(["tpl-a"]);
    expect(comparison.rows[0].baselineScore).toBe(0.8);
  });

  it("does not flag improvements or equal scores", () => {
    const comparison = compareResultsToBaseline(
      [{ template: "tpl-a", result: { score: 0.8, status: "completed" } }],
      [{ template: "tpl-a", result: { score: 0.8, status: "completed" } }],
      0,
    );
    expect(comparison.regressed).toBe(false);
  });

  it("honours regression_tolerance before flagging", () => {
    const comparison = compareResultsToBaseline(
      [{ template: "tpl-a", result: { score: 0.75, status: "completed" } }],
      [{ template: "tpl-a", result: { score: 0.8, status: "completed" } }],
      0.1,
    );
    expect(comparison.regressed).toBe(false);
  });

  it("treats missing scores as incomparable, not regressed", () => {
    const comparison = compareResultsToBaseline(
      [{ template: "tpl-a", result: { status: "completed" } }],
      [{ template: "tpl-a", result: { score: 0.8, status: "completed" } }],
      0,
    );
    expect(comparison.regressed).toBe(false);
    expect(comparison.comparableCount).toBe(0);
    expect(comparison.rows[0].regressed).toBeNull();
  });
});

describe("evaluationDecision with a baseline", () => {
  const okResults = [
    { template: "tpl-a", result: { score: 0.7, status: "completed" } },
  ];

  it("fails with 'Regression detected' even above pass_threshold", () => {
    const decision = evaluationDecision(okResults, 0.7, 0.5, {
      regressed: true,
      regressedTemplates: ["tpl-a"],
    });
    expect(decision.conclusion).toBe("failure");
    expect(decision.label).toBe("Regression detected");
    expect(decision.remediation).toContain("tpl-a");
  });

  it("passes when the baseline shows no regression and score ≥ threshold", () => {
    const decision = evaluationDecision(okResults, 0.7, 0.5, {
      regressed: false,
      regressedTemplates: [],
    });
    expect(decision.conclusion).toBe("success");
  });
});

describe("renderBaselineTable / normalizeRegressionTolerance", () => {
  it("renders a per-template delta table with a regression flag", () => {
    const table = renderBaselineTable({
      rows: [
        {
          template: "tpl-a",
          score: 0.6,
          baselineScore: 0.8,
          regressed: true,
        },
      ],
    });
    expect(table).toContain("Base-branch score");
    expect(table).toContain("-20.0%");
    expect(table).toContain("⚠");
  });

  it("clamps tolerance into [0,1] and rejects non-numbers", () => {
    expect(normalizeRegressionTolerance(undefined)).toBe(0);
    expect(normalizeRegressionTolerance(2)).toBe(1);
    expect(() => normalizeRegressionTolerance("x")).toThrow(
      "regression_tolerance",
    );
  });
});

describe("runPullRequestEvaluation regression path", () => {
  const configYaml =
    "pass_threshold: 0.5\ntemplates:\n  - id: tpl-1\n    name: tpl-a\n";

  async function run(scores, extraConfig = "") {
    mockScores = scores;
    mockEvaluationCalls.length = 0;
    const app = makeApp();
    const statuses = [];
    const octokit = makeOctokit(configYaml + extraConfig, statuses);
    app.githubApp._installationOctokit = octokit;
    app.githubApp.getInstallationOctokit = async () => octokit;
    await app.runPullRequestEvaluation(
      octokit,
      repository,
      pullRequest,
      undefined,
      "attempt-1",
    );
    return { statuses, octokit };
  }

  it("reports failure when the PR score regresses below base", async () => {
    const { statuses } = await run({ head: 0.7, base: 0.9 });
    const final = statuses[statuses.length - 1];
    expect(final.state).toBe("failure");
    // one head evaluation + one base-branch evaluation
    expect(mockEvaluationCalls).toEqual(["head", "base"]);
  });

  it("reports success when the PR score improves on base", async () => {
    const { statuses } = await run({ head: 0.95, base: 0.6 });
    const final = statuses[statuses.length - 1];
    expect(final.state).toBe("success");
    expect(mockEvaluationCalls).toEqual(["head", "base"]);
  });

  it("skips the baseline run when compare_to_base is false", async () => {
    const { statuses } = await run(
      { head: 0.9, base: 0.95 },
      "compare_to_base: false\n",
    );
    const final = statuses[statuses.length - 1];
    // score 0.9 >= threshold 0.5 and baseline disabled -> pass
    expect(final.state).toBe("success");
    expect(mockEvaluationCalls).toEqual(["head"]);
  });
});
