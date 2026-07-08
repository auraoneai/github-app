const mockApp = jest.fn().mockImplementation(() => ({
  webhooks: {
    on: jest.fn(),
  },
}));

const mockAuraOneClient = jest.fn().mockImplementation(() => ({}));

jest.mock("@octokit/app", () => ({
  App: mockApp,
}));

jest.mock("@auraone/sdk", () => ({
  AuraOneClient: mockAuraOneClient,
}));

const AuraGitHubApp = require("../src/app");

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
      AURAONE_BASE_URL: "https://api.example.test",
      AURAONE_ORG_ID: "org-123",
    };
    delete process.env.AURA_API_KEY;
    delete process.env.AURA_BASE_URL;
    delete process.env.AURA_ORG_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("uses documented AuraOne environment variables when no options are passed", () => {
    const app = new AuraGitHubApp();

    expect(mockAuraOneClient).toHaveBeenCalledWith({
      apiKey: "auraone-key",
      baseUrl: "https://api.example.test",
    });
    expect(app.orgId).toBe("org-123");
  });
});
