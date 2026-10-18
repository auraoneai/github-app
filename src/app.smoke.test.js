/**
 * PR-19 T-P1-09 smoke test: signed webhook fixture -> pull_request handler.
 *
 * Verifies (1) startup fails without GITHUB_WEBHOOK_SECRET, (2) a properly
 * signed pull_request payload is accepted by the webhooks layer, and (3) an
 * unsigned/tampered payload is rejected.
 */

const crypto = require("node:crypto");

const WEBHOOK_SECRET = "smoke-test-webhook-secret";

jest.mock("@octokit/app", () => {
  const nodeCrypto = require("node:crypto");
  const handlers = new Map();
  class FakeWebhooks {
    constructor({ secret }) {
      this.secret = secret;
    }
    on(event, handler) {
      handlers.set(event, handler);
    }
    async verifyAndReceive({ id, name, payload, signature }) {
      const expected =
        "sha256=" +
        nodeCrypto
          .createHmac("sha256", this.secret)
          .update(payload)
          .digest("hex");
      if (signature !== expected) {
        const err = new Error("signature mismatch");
        err.status = 400;
        throw err;
      }
      const handler = handlers.get(name);
      if (handler) {
        await handler({
          id,
          name,
          payload: JSON.parse(payload),
          octokit: null,
        });
      }
    }
  }
  class FakeApp {
    constructor(options) {
      this.webhooks = new FakeWebhooks(options.webhooks);
      this._options = options;
    }
    async getInstallationOctokit() {
      return this._installationOctokit;
    }
  }
  return { App: FakeApp };
});

jest.mock(
  "@auraone/sdk",
  () => {
    const created = [];
  class FakeAuraOneClient {
    constructor(config) {
      this.config = config;
      created.push(config);
      this.evaluations = { create: jest.fn(async () => ({ id: "eval_1" })) };
    }
    getBaseUrl() {
      return this.config.baseUrl;
    }
  }
    return { AuraOneClient: FakeAuraOneClient, __created: created };
  },
  { virtual: true },
);

const AuraGitHubApp = require("./app");

const VALID_KEY = "ak_" + "0".repeat(8) + "_" + "f".repeat(64);

function sign(payload) {
  return (
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")
  );
}

function pullRequestPayload() {
  return JSON.stringify({
    action: "opened",
    installation: { id: 42 },
    repository: {
      name: "demo",
      full_name: "octo/demo",
      private: false,
      owner: { login: "octo" },
    },
    pull_request: {
      id: 7,
      number: 3,
      head: { sha: "deadbeef" },
    },
  });
}

describe("AuraGitHubApp smoke", () => {
  it("fails to construct without a webhook secret", () => {
    expect(
      () =>
        new AuraGitHubApp({
          appId: "1",
          privateKey: "k",
          webhookSecret: "",
          auraApiKey: VALID_KEY,
        }),
    ).toThrow("GITHUB_WEBHOOK_SECRET");
  });

  it("fails to construct without a platform ak_ key", () => {
    expect(
      () =>
        new AuraGitHubApp({
          appId: "1",
          privateKey: "k",
          webhookSecret: WEBHOOK_SECRET,
          auraApiKey: "aura_live_" + "x".repeat(32),
        }),
    ).toThrow("ak_");
  });

  it("accepts a correctly signed pull_request payload", async () => {
    const app = new AuraGitHubApp({
      appId: "1",
      privateKey: "k",
      webhookSecret: WEBHOOK_SECRET,
      auraApiKey: VALID_KEY,
      orgId: "org_1",
    });
    const octokit = {
      rest: {
        repos: {
          createCommitStatus: jest.fn(async () => ({})),
          getContent: jest.fn(async () => {
            throw new Error("404");
          }),
        },
        issues: { createComment: jest.fn(async () => ({})) },
      },
      auth: jest.fn(async () => ({ token: "inst-token" })),
    };
    app.githubApp._installationOctokit = octokit;
    app.githubApp.getInstallationOctokit = async () => octokit;

    const payload = pullRequestPayload();
    await expect(
      app.githubApp.webhooks.verifyAndReceive({
        id: "evt-1",
        name: "pull_request.opened",
        signature: sign(payload),
        payload,
      }),
    ).resolves.toBeUndefined();
    expect(octokit.rest.repos.createCommitStatus).toHaveBeenCalled();
  });

  it("rejects a tampered signature", async () => {
    const app = new AuraGitHubApp({
      appId: "1",
      privateKey: "k",
      webhookSecret: WEBHOOK_SECRET,
      auraApiKey: VALID_KEY,
    });
    const payload = pullRequestPayload();
    await expect(
      app.githubApp.webhooks.verifyAndReceive({
        id: "evt-2",
        name: "pull_request.opened",
        signature: "sha256=" + "0".repeat(64),
        payload,
      }),
    ).rejects.toThrow("signature mismatch");
  });
});
