const mockWebhookOn = jest.fn();
const mockApp = jest.fn().mockImplementation(() => ({
  webhooks: {
    on: mockWebhookOn,
  },
}));
const mockEvaluationCreate = jest.fn();
const mockAuraOneClient = jest.fn().mockImplementation((options) => ({
  ...options,
  evaluations: {
    create: mockEvaluationCreate,
  },
}));

jest.mock("@octokit/app", () => ({
  App: mockApp,
}));

jest.mock("@auraone/sdk", () => ({
  AuraOneClient: mockAuraOneClient,
}));

const AuraGitHubApp = require("../src/app");
const {
  COMMENT_MARKER,
  escapeMarkdownCell,
} = require("../src/app");

const repository = {
  owner: { login: "auraoneai" },
  name: "example-agent",
};
const pullRequest = {
  id: 987,
  number: 42,
  head: { sha: "abc123" },
};

function encodedConfig(config) {
  return {
    data: {
      type: "file",
      content: Buffer.from(config).toString("base64"),
    },
  };
}

function makeOctokit(overrides = {}) {
  return {
    rest: {
      checks: {
        listForRef: jest.fn().mockResolvedValue({
          data: { check_runs: [] },
        }),
        create: jest.fn().mockResolvedValue({ data: { id: 123 } }),
        update: jest.fn().mockResolvedValue({ data: {} }),
      },
      repos: {
        getContent: jest.fn(),
      },
      issues: {
        listComments: jest.fn().mockResolvedValue({ data: [] }),
        createComment: jest.fn().mockResolvedValue({ data: {} }),
        updateComment: jest.fn().mockResolvedValue({ data: {} }),
      },
      pulls: {
        get: jest.fn().mockResolvedValue({ data: pullRequest }),
      },
      ...overrides.rest,
    },
    ...overrides,
  };
}

function completedUpdate(octokit) {
  return octokit.rest.checks.update.mock.calls
    .map(([parameters]) => parameters)
    .find(({ status }) => status === "completed");
}

describe("AuraGitHubApp", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_APP_ID: "123456",
      GITHUB_PRIVATE_KEY: "private-key",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      AURAONE_API_KEY: "auraone-key",
      AURAONE_BASE_URL: "https://api.example.test/api",
      AURAONE_ORG_ID: "org-123",
    };
    delete process.env.AURA_API_KEY;
    delete process.env.AURA_BASE_URL;
    delete process.env.AURA_ORG_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("uses documented environment variables and registers Check Run actions", () => {
    const app = new AuraGitHubApp();

    expect(mockAuraOneClient).toHaveBeenCalledWith({
      apiKey: "auraone-key",
      baseUrl: "https://api.example.test/api",
    });
    expect(app.orgId).toBe("org-123");
    expect(mockWebhookOn.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        "pull_request.opened",
        "pull_request.synchronize",
        "check_run.requested_action",
        "push",
      ]),
    );
  });

  test("escapes untrusted Markdown table content", () => {
    expect(
      escapeMarkdownCell("<script>| [link](bad)\n`code`_*"),
    ).toBe(
      "&lt;script&gt;&#124; &#91;link&#93;(bad)<br>&#96;code&#96;&#95;&#42;",
    );
  });

  test("publishes a successful Check Run and PR evidence summary", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue(
      encodedConfig(`
pass_threshold: 0.85
templates:
  - id: rubric.web.qa
    name: "<script>| Web QA"
    reward_spec_id: qa-regression
`),
    );
    mockEvaluationCreate.mockResolvedValue({
      id: "eval/123",
      status: "completed",
      score: 0.91,
      summary: "All required behavior was observed.",
    });

    await app.runPullRequestEvaluation(octokit, repository, pullRequest);

    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AuraOne evaluation",
        head_sha: "abc123",
        status: "queued",
      }),
    );
    expect(octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 123,
        status: "in_progress",
      }),
    );

    const finalCheck = completedUpdate(octokit);
    expect(finalCheck).toEqual(
      expect.objectContaining({
        conclusion: "success",
        details_url: "https://api.example.test/evaluations/eval%2F123",
        actions: [
          {
            label: "Run again",
            description: "Run the AuraOne evaluation again",
            identifier: "rerun",
          },
        ],
      }),
    );
    expect(finalCheck.output.summary).toContain("**Decision:** Passed");
    expect(finalCheck.output.summary).toContain("**Required threshold:** 85.0%");
    expect(finalCheck.output.summary).toContain("`abc123`");
    expect(finalCheck.output.summary).toContain("`.auraone.yml`");
    expect(finalCheck.output.text).toContain("&lt;script&gt;&#124; Web QA");
    expect(finalCheck.output.text).toContain("No remediation is required");

    const comment = octokit.rest.issues.createComment.mock.calls[0][0].body;
    expect(comment).toContain(COMMENT_MARKER);
    expect(comment).toContain("**Decision:** Passed");
    expect(comment).toContain("&lt;script&gt;&#124; Web QA");
    expect(comment).not.toMatch(/[✅❌]/u);
  });

  test("updates the existing app-owned summary comment in place", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        {
          id: 10,
          user: { type: "User" },
          body: COMMENT_MARKER,
        },
        {
          id: 20,
          user: { type: "Bot" },
          body: `${COMMENT_MARKER}\nold report`,
        },
      ],
    });

    await app.upsertEvaluationComment(
      octokit,
      repository,
      pullRequest,
      {
        decision: "Failed",
        score: 0,
        threshold: 0.8,
        sha: pullRequest.head.sha,
        configPath: ".auraone.yml",
        results: [],
        remediation: "Fix the failure.",
      },
    );

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 20,
        body: expect.stringContaining("**Decision:** Failed"),
      }),
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  test("uses action-required copy when a template cannot complete", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue(
      encodedConfig(`
templates:
  - id: rubric.web.qa
    name: Web QA
`),
    );
    mockEvaluationCreate.mockRejectedValue(
      new Error("Template service unavailable | retry later"),
    );

    await app.runPullRequestEvaluation(octokit, repository, pullRequest);

    const finalCheck = completedUpdate(octokit);
    expect(finalCheck.conclusion).toBe("action_required");
    expect(finalCheck.output.summary).toContain(
      "**Decision:** Action required",
    );
    expect(finalCheck.output.text).toContain(
      "Template service unavailable &#124; retry later",
    );
    expect(finalCheck.output.text).toContain(
      "Verify the template identifiers",
    );
  });

  test("publishes a neutral result with setup remediation when config is absent", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    const notFound = Object.assign(new Error("Not found"), { status: 404 });
    octokit.rest.repos.getContent.mockRejectedValue(notFound);

    await app.runPullRequestEvaluation(octokit, repository, pullRequest);

    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    const finalCheck = completedUpdate(octokit);
    expect(finalCheck.conclusion).toBe("neutral");
    expect(finalCheck.output.summary).toContain("**Decision:** Skipped");
    expect(finalCheck.output.text).toContain("Add &#96;.auraone.yml&#96;");
  });

  test("reruns the existing Check Run when the requested action is received", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    app.githubApp.getInstallationOctokit = jest
      .fn()
      .mockResolvedValue(octokit);
    const runSpy = jest
      .spyOn(app, "runPullRequestEvaluation")
      .mockResolvedValue();

    await app.handleRequestedAction({
      id: "delivery-123",
      payload: {
        installation: { id: 55 },
        repository,
        requested_action: { identifier: "rerun" },
        check_run: {
          id: 321,
          pull_requests: [{ number: pullRequest.number }],
        },
      },
    });

    expect(octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "auraoneai",
      repo: "example-agent",
      pull_number: 42,
    });
    expect(runSpy).toHaveBeenCalledWith(
      octokit,
      repository,
      pullRequest,
      321,
      "delivery-123",
    );
  });

  test("does not replace a successful check when optional comment publishing fails", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue(
      encodedConfig(`
templates:
  - id: rubric.web.qa
    name: Web QA
`),
    );
    octokit.rest.issues.listComments.mockRejectedValue(
      new Error("Issues permission is unavailable"),
    );
    mockEvaluationCreate.mockResolvedValue({
      id: "eval-1",
      status: "completed",
      score: 1,
    });

    await app.runPullRequestEvaluation(octokit, repository, pullRequest);

    const completedChecks = octokit.rest.checks.update.mock.calls
      .map(([parameters]) => parameters)
      .filter(({ status }) => status === "completed");
    expect(completedChecks).toHaveLength(1);
    expect(completedChecks[0].conclusion).toBe("success");
  });

  test("can disable the PR comment while retaining the Check Run", async () => {
    const app = new AuraGitHubApp();
    const octokit = makeOctokit();
    octokit.rest.repos.getContent.mockResolvedValue(
      encodedConfig(`
pr_comment: false
templates:
  - id: rubric.web.qa
    name: Web QA
`),
    );
    mockEvaluationCreate.mockResolvedValue({
      id: "eval-1",
      status: "completed",
      score: 1,
    });

    await app.runPullRequestEvaluation(octokit, repository, pullRequest);

    expect(completedUpdate(octokit).conclusion).toBe("success");
    expect(octokit.rest.issues.listComments).not.toHaveBeenCalled();
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
