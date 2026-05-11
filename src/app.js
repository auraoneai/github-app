/**
 * AuraOne GitHub App
 * Automated evaluation runs on PR changes
 */

const { App } = require("@octokit/app");
const { AuraOneClient } = require("@auraone/sdk");

/** Structured logger for the GitHub App */
const logger = {
  info: (msg, ctx) => console.log(`[AuraOne GitHubApp] ${msg}`, ctx !== undefined ? ctx : ""),
  warn: (msg, ctx) => console.warn(`[AuraOne GitHubApp] ${msg}`, ctx !== undefined ? ctx : ""),
  error: (msg, err, ctx) => {
    const parts = [`[AuraOne GitHubApp] ${msg}`];
    if (err !== undefined) parts.push(err);
    if (ctx !== undefined) parts.push(ctx);
    console.error(...parts);
  },
};

class AuraGitHubApp {
  constructor(options = {}) {
    this.githubApp = new App({
      appId: options.appId || process.env.GITHUB_APP_ID,
      privateKey: options.privateKey || process.env.GITHUB_PRIVATE_KEY,
      webhooks: {
        secret: options.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET,
      },
    });

    this.auraClient = new AuraOneClient({
      apiKey: options.auraApiKey || process.env.AURA_API_KEY,
      baseUrl:
        options.auraBaseUrl ||
        process.env.AURA_BASE_URL ||
        "https://api.auraone.ai",
    });
    this.orgId = options.orgId || process.env.AURA_ORG_ID;

    this.setupWebhooks();
  }

  setupWebhooks() {
    // Handle pull request events
    this.githubApp.webhooks.on("pull_request.opened", async (context) => {
      await this.handlePullRequest(context);
    });

    this.githubApp.webhooks.on("pull_request.synchronize", async (context) => {
      await this.handlePullRequest(context);
    });

    // Handle push to main/master
    this.githubApp.webhooks.on("push", async (context) => {
      if (
        context.payload.ref === "refs/heads/main" ||
        context.payload.ref === "refs/heads/master"
      ) {
        await this.handleMainPush(context);
      }
    });
  }

  async handlePullRequest(context) {
    const { pull_request, repository } = context.payload;

    try {
      // Get installation client
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );

      // Post initial status
      await this.postStatus(octokit, repository, pull_request.head.sha, {
        state: "pending",
        description: "AuraOne evaluation in progress...",
        context: "auraone/evaluation",
      });

      // Find evaluation config in repo
      const config = await this.getEvaluationConfig(
        octokit,
        repository,
        pull_request.head.sha,
      );

      if (!config) {
        await this.postStatus(octokit, repository, pull_request.head.sha, {
          state: "success",
          description: "No AuraOne config found - skipping evaluation",
          context: "auraone/evaluation",
        });
        return;
      }

      // Create bundle URL from PR
      const bundleUrl = await this.createAgentBundle(
        octokit,
        repository,
        pull_request,
      );

      // Run evaluations for each template
      const results = [];

      for (const template of config.templates || []) {
        try {
          const result = await this.auraClient.evaluations.create({
            template_id: template.id,
            agent_bundle_url: bundleUrl,
            reward_spec_id: template.reward_spec_id,
            config: template.config,
            wait: true,
            timeoutSeconds: 600,
            idempotencyKey: `gh-${pull_request.id}-${template.id}`,
          });

          results.push({ template: template.name, result });
        } catch (error) {
          logger.error(
            `Evaluation failed for template ${template.name}`,
            error,
          );
          results.push({
            template: template.name,
            error: error.message,
            result: { status: "failed", score: 0 },
          });
        }
      }

      // Calculate overall score
      const validResults = results.filter(
        (r) => r.result && r.result.score !== undefined,
      );
      const overallScore =
        validResults.length > 0
          ? validResults.reduce((sum, r) => sum + r.result.score, 0) /
            validResults.length
          : 0;

      // Post final status
      const passed = overallScore >= (config.pass_threshold || 0.8);

      await this.postStatus(octokit, repository, pull_request.head.sha, {
        state: passed ? "success" : "failure",
        description: `Evaluation ${passed ? "passed" : "failed"} - Score: ${(overallScore * 100).toFixed(1)}%`,
        context: "auraone/evaluation",
        target_url: this.getDetailsUrl(results[0]?.result?.id),
      });

      // Post detailed comment
      await this.postEvaluationComment(
        octokit,
        repository,
        pull_request,
        results,
        overallScore,
      );
    } catch (error) {
      logger.error("Error handling pull request", error);

      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );
      await this.postStatus(octokit, repository, pull_request.head.sha, {
        state: "error",
        description: "AuraOne evaluation error",
        context: "auraone/evaluation",
      });
    }
  }

  async handleMainPush(context) {
    const { repository, commits } = context.payload;

    try {
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );

      // Get evaluation config
      const config = await this.getEvaluationConfig(
        octokit,
        repository,
        context.payload.after,
      );

      if (!config || !config.benchmark_on_main) {
        return;
      }

      // Create bundle and run benchmark evaluations
      const bundleUrl = await this.createAgentBundle(octokit, repository, {
        head: { sha: context.payload.after },
      });

      for (const template of config.benchmark_templates || []) {
        await this.auraClient.evaluations.create({
          template_id: template.id,
          agent_bundle_url: bundleUrl,
          reward_spec_id: template.reward_spec_id,
          config: { ...template.config, benchmark: true },
          wait: false,
          idempotencyKey: `gh-main-${context.payload.after}-${template.id}`,
        });
      }
    } catch (error) {
      logger.error("Error handling main push", error);
    }
  }

  async getEvaluationConfig(octokit, repository, sha) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: repository.owner.login,
        repo: repository.name,
        path: ".auraone.yml",
        ref: sha,
      });

      if (data.type === "file" && data.content) {
        const content = Buffer.from(data.content, "base64").toString();
        return require("js-yaml").load(content);
      }
    } catch (error) {
      // Try .auraone.yaml as fallback
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: repository.owner.login,
          repo: repository.name,
          path: ".auraone.yaml",
          ref: sha,
        });

        if (data.type === "file" && data.content) {
          const content = Buffer.from(data.content, "base64").toString();
          return require("js-yaml").load(content);
        }
      } catch (error2) {
        logger.info("No AuraOne config found");
      }
    }

    return null;
  }

  async createAgentBundle(octokit, repository, pullRequest) {
    // For MVP, return archive URL
    // in deployed environments, would create proper bundle with dependencies
    return `https://github.com/${repository.owner.login}/${repository.name}/archive/${pullRequest.head.sha}.tar.gz`;
  }

  async postStatus(octokit, repository, sha, status) {
    await octokit.rest.repos.createCommitStatus({
      owner: repository.owner.login,
      repo: repository.name,
      sha,
      ...status,
    });
  }

  async postEvaluationComment(
    octokit,
    repository,
    pullRequest,
    results,
    overallScore,
  ) {
    const passed = overallScore >= 0.8;
    const emoji = passed ? "✅" : "❌";

    let comment = `${emoji} **AuraOne Evaluation Results**\n\n`;
    comment += `**Overall Score:** ${(overallScore * 100).toFixed(1)}% ${passed ? "(Passed)" : "(Failed)"}\n\n`;
    comment += `| Template | Score | Status |\n`;
    comment += `|----------|-------|--------|\n`;

    for (const { template, result, error } of results) {
      if (error) {
        comment += `| ${template} | - | ❌ Error: ${error} |\n`;
      } else if (result) {
        const score = result.score
          ? `${(result.score * 100).toFixed(1)}%`
          : "N/A";
        const status =
          result.status === "completed" ? "✅ Completed" : "❌ Failed";
        comment += `| ${template} | ${score} | ${status} |\n`;
      }
    }

    comment += "\n---\n";
    comment +=
      "*Generated with [AuraOne](https://www.auraone.ai) - structured AI agent evaluation*";

    await octokit.rest.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pullRequest.number,
      body: comment,
    });
  }

  getDetailsUrl(evaluationId) {
    if (!evaluationId) return null;
    return `${this.auraClient.baseUrl.replace("/api", "")}/evaluations/${evaluationId}`;
  }

  // Server setup for webhooks
  createServer(port = process.env.PORT || 3000) {
    const { createServer } = require("http");
    const { createNodeMiddleware } = require("@octokit/webhooks");

    const middleware = createNodeMiddleware(this.githubApp.webhooks, {
      path: "/api/github/webhooks",
    });

    const server = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "healthy",
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      await middleware(req, res);
    });

    server.listen(port, () => {
      logger.info(`AuraOne GitHub App listening on port ${port}`);
    });

    return server;
  }
}

module.exports = AuraGitHubApp;

// CLI entry point
if (require.main === module) {
  const app = new AuraGitHubApp();
  app.createServer();
}
