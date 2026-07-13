/**
 * AuraOne GitHub App
 * Automated evaluation runs on pull request changes.
 */

const { App } = require("@octokit/app");
const { AuraOneClient } = require("@auraone/sdk");
const yaml = require("js-yaml");

const CHECK_NAME = "AuraOne evaluation";
const COMMENT_MARKER = "<!-- auraone-evaluation-summary -->";
const DEFAULT_PASS_THRESHOLD = 0.8;
const CONFIG_PATHS = [".auraone.yml", ".auraone.yaml"];
const GITHUB_MARKDOWN_LIMIT = 60000;

/** Structured logger for the GitHub App. */
const logger = {
  info: (msg, ctx) =>
    console.log(`[AuraOne GitHubApp] ${msg}`, ctx !== undefined ? ctx : ""),
  warn: (msg, ctx) =>
    console.warn(`[AuraOne GitHubApp] ${msg}`, ctx !== undefined ? ctx : ""),
  error: (msg, err, ctx) => {
    const parts = [`[AuraOne GitHubApp] ${msg}`];
    if (err !== undefined) parts.push(err);
    if (ctx !== undefined) parts.push(ctx);
    console.error(...parts);
  },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeThreshold(value) {
  const threshold = Number(value ?? DEFAULT_PASS_THRESHOLD);
  if (!Number.isFinite(threshold)) {
    throw new Error("`pass_threshold` must be a number from 0 to 1.");
  }
  return clamp(threshold, 0, 1);
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function stripControlCharacters(value) {
  return value
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}

function escapeMarkdownCell(value, maxLength = 2000) {
  const escaped = String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "&#92;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;")
    .replace(/\*/g, "&#42;")
    .replace(/_/g, "&#95;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\r?\n/g, "<br>");

  return stripControlCharacters(escaped).slice(0, maxLength);
}

function limitMarkdown(value) {
  if (value.length <= GITHUB_MARKDOWN_LIMIT) return value;
  return `${value.slice(0, GITHUB_MARKDOWN_LIMIT - 82)}\n\n_Output truncated. Open the AuraOne evidence record for the complete result._`;
}

function safeErrorMessage(error) {
  const message =
    error && typeof error.message === "string"
      ? error.message
      : "An unexpected error occurred.";
  return message.slice(0, 1000);
}

function repositoryCoordinates(repository) {
  return {
    owner: repository.owner.login,
    repo: repository.name,
  };
}

function configUrl(repository, sha, configPath) {
  if (!configPath) return null;
  const { owner, repo } = repositoryCoordinates(repository);
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/blob/${encodeURIComponent(sha)}/${configPath}`;
}

function buildResultRows(results) {
  return results.map(({ template, result, error }) => {
    const score =
      result && Number.isFinite(Number(result.score))
        ? formatPercent(result.score)
        : "Not available";

    let status = "Failed";
    let detail = "The evaluation did not complete.";

    if (error) {
      status = "Error";
      detail = error;
    } else if (result && result.status === "completed") {
      status = "Completed";
      detail = result.summary || "Evaluation completed.";
    } else if (result && result.status) {
      status = String(result.status);
      detail = result.summary || "Review the evaluation evidence.";
    }

    return {
      template: escapeMarkdownCell(template || "Unnamed template"),
      score: escapeMarkdownCell(score),
      status: escapeMarkdownCell(status),
      detail: escapeMarkdownCell(detail),
    };
  });
}

function renderResultTable(results, includeDetail = true) {
  const rows = buildResultRows(results);

  if (rows.length === 0) {
    return "No evaluation templates ran.";
  }

  const header = includeDetail
    ? "| Template | Score | Status | Detail |\n| --- | ---: | --- | --- |"
    : "| Template | Score | Status |\n| --- | ---: | --- |";
  const body = rows
    .map((row) =>
      includeDetail
        ? `| ${row.template} | ${row.score} | ${row.status} | ${row.detail} |`
        : `| ${row.template} | ${row.score} | ${row.status} |`,
    )
    .join("\n");

  return `${header}\n${body}`;
}

function evaluationDecision(results, score, threshold) {
  const hasErrors = results.some(({ error, result }) => {
    return Boolean(error) || !result || result.status !== "completed";
  });

  if (hasErrors) {
    return {
      label: "Action required",
      conclusion: "action_required",
      remediation:
        "Verify the template identifiers, reward specifications, AuraOne credentials, and service availability. Then use **Run again** on this check.",
    };
  }

  if (score < threshold) {
    return {
      label: "Failed",
      conclusion: "failure",
      remediation:
        "Review the template evidence below, address the failing behavior, and push an updated commit or use **Run again** after the evidence changes.",
    };
  }

  return {
    label: "Passed",
    conclusion: "success",
    remediation: "No remediation is required for this commit.",
  };
}

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
      apiKey:
        options.auraApiKey ||
        process.env.AURAONE_API_KEY ||
        process.env.AURA_API_KEY,
      baseUrl:
        options.auraBaseUrl ||
        process.env.AURAONE_BASE_URL ||
        process.env.AURA_BASE_URL ||
        "https://api.auraone.ai",
    });
    this.orgId =
      options.orgId || process.env.AURAONE_ORG_ID || process.env.AURA_ORG_ID;

    this.setupWebhooks();
  }

  setupWebhooks() {
    this.githubApp.webhooks.on("pull_request.opened", async (context) => {
      await this.handlePullRequest(context);
    });

    this.githubApp.webhooks.on("pull_request.synchronize", async (context) => {
      await this.handlePullRequest(context);
    });

    this.githubApp.webhooks.on(
      "check_run.requested_action",
      async (context) => {
        await this.handleRequestedAction(context);
      },
    );

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
    const { pull_request: pullRequest, repository } = context.payload;

    try {
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );
      await this.runPullRequestEvaluation(octokit, repository, pullRequest);
    } catch (error) {
      logger.error("Unable to initialize pull request evaluation", error);
    }
  }

  async handleRequestedAction(context) {
    const { check_run: checkRun, repository, requested_action: action } =
      context.payload;

    if (action.identifier !== "rerun") {
      logger.warn("Ignoring unsupported Check Run action", {
        identifier: action.identifier,
      });
      return;
    }

    try {
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );
      const pullRequestReference = checkRun.pull_requests?.[0];

      if (!pullRequestReference) {
        await this.completeCheckRun(octokit, repository, checkRun.id, {
          conclusion: "action_required",
          title: "AuraOne evaluation needs a pull request",
          summary:
            "The requested evaluation could not be rerun because GitHub did not associate this check with a pull request.",
          text:
            "Push a new commit to the pull request, or start the evaluation from a Check Run that is attached to the pull request.",
        });
        return;
      }

      const { data: pullRequest } = await octokit.rest.pulls.get({
        ...repositoryCoordinates(repository),
        pull_number: pullRequestReference.number,
      });

      await this.runPullRequestEvaluation(
        octokit,
        repository,
        pullRequest,
        checkRun.id,
        context.id || checkRun.completed_at || String(checkRun.id),
      );
    } catch (error) {
      logger.error("Unable to rerun pull request evaluation", error);
    }
  }

  async runPullRequestEvaluation(
    octokit,
    repository,
    pullRequest,
    existingCheckRunId,
    evaluationAttempt,
  ) {
    let checkRunId = existingCheckRunId;
    let configPath = null;

    try {
      checkRunId =
        checkRunId ||
        (await this.startCheckRun(
          octokit,
          repository,
          pullRequest.head.sha,
          pullRequest.id,
        ));

      if (existingCheckRunId) {
        await this.markCheckRunInProgress(
          octokit,
          repository,
          existingCheckRunId,
        );
      }

      const configRecord = await this.getEvaluationConfig(
        octokit,
        repository,
        pullRequest.head.sha,
      );

      if (!configRecord) {
        const skipped = {
          decision: "Skipped",
          score: null,
          threshold: DEFAULT_PASS_THRESHOLD,
          sha: pullRequest.head.sha,
          configPath: "Not found",
          results: [],
          remediation:
            "Add `.auraone.yml` or `.auraone.yaml` to the evaluated commit to enable AuraOne pull request checks.",
        };

        await this.completeCheckRun(octokit, repository, checkRunId, {
          conclusion: "neutral",
          title: "AuraOne evaluation skipped",
          summary: this.renderCheckSummary(skipped),
          text: this.renderCheckText(skipped, repository),
        });
        await this.publishEvaluationComment(
          octokit,
          repository,
          pullRequest,
          skipped,
        );
        return;
      }

      const { config } = configRecord;
      configPath = configRecord.path;
      const threshold = normalizeThreshold(config.pass_threshold);
      const templates = Array.isArray(config.templates) ? config.templates : [];

      if (templates.length === 0) {
        const emptyConfig = {
          decision: "Action required",
          score: null,
          threshold,
          sha: pullRequest.head.sha,
          configPath,
          results: [],
          remediation:
            "Add at least one entry under `templates` in the AuraOne configuration, then use **Run again**.",
        };

        await this.completeCheckRun(octokit, repository, checkRunId, {
          conclusion: "action_required",
          title: "AuraOne configuration needs a template",
          summary: this.renderCheckSummary(emptyConfig),
          text: this.renderCheckText(emptyConfig, repository),
        });
        await this.publishEvaluationComment(
          octokit,
          repository,
          pullRequest,
          emptyConfig,
          config.pr_comment !== false,
        );
        return;
      }

      const bundleUrl = await this.createAgentBundle(
        octokit,
        repository,
        pullRequest,
      );
      const results = await this.runEvaluations(
        templates,
        bundleUrl,
        pullRequest,
        evaluationAttempt,
      );
      const scoredResults = results.filter(({ result }) =>
        Number.isFinite(Number(result?.score)),
      );
      const overallScore =
        scoredResults.length > 0
          ? scoredResults.reduce(
              (sum, { result }) => sum + Number(result.score),
              0,
            ) / scoredResults.length
          : 0;
      const decision = evaluationDecision(results, overallScore, threshold);
      const report = {
        decision: decision.label,
        score: overallScore,
        threshold,
        sha: pullRequest.head.sha,
        configPath,
        results,
        remediation: decision.remediation,
      };
      const detailsUrl = this.getDetailsUrl(
        results.find(({ result }) => result?.id)?.result.id,
      );

      await this.completeCheckRun(octokit, repository, checkRunId, {
        conclusion: decision.conclusion,
        title: `AuraOne evaluation ${decision.label.toLowerCase()}`,
        summary: this.renderCheckSummary(report),
        text: this.renderCheckText(report, repository),
        detailsUrl,
      });
      await this.publishEvaluationComment(
        octokit,
        repository,
        pullRequest,
        report,
        config.pr_comment !== false,
      );
    } catch (error) {
      logger.error("Error handling pull request evaluation", error);
      const message = safeErrorMessage(error);
      const report = {
        decision: "Error",
        score: null,
        threshold: DEFAULT_PASS_THRESHOLD,
        sha: pullRequest.head.sha,
        configPath: configPath || "Unavailable",
        results: [],
        remediation:
          "Verify the AuraOne configuration syntax, GitHub App permissions, API credentials, and service availability. Then use **Run again**.",
        error: message,
      };

      if (checkRunId) {
        try {
          await this.completeCheckRun(octokit, repository, checkRunId, {
            conclusion: "failure",
            title: "AuraOne evaluation error",
            summary: this.renderCheckSummary(report),
            text: this.renderCheckText(report, repository),
          });
        } catch (checkError) {
          logger.error("Unable to publish failed Check Run", checkError);
        }
      }

      try {
        await this.publishEvaluationComment(
          octokit,
          repository,
          pullRequest,
          report,
        );
      } catch (commentError) {
        logger.error("Unable to publish evaluation error comment", commentError);
      }
    }
  }

  async runEvaluations(
    templates,
    bundleUrl,
    pullRequest,
    evaluationAttempt = pullRequest.head.sha,
  ) {
    const results = [];

    for (const template of templates) {
      const templateName = template.name || template.id || "Unnamed template";

      if (!template.id) {
        results.push({
          template: templateName,
          error: "The template is missing its required `id`.",
          result: { status: "failed" },
        });
        continue;
      }

      try {
        const result = await this.auraClient.evaluations.create({
          template_id: template.id,
          agent_bundle_url: bundleUrl,
          reward_spec_id: template.reward_spec_id,
          config: template.config,
          wait: true,
          timeoutSeconds: 600,
          idempotencyKey: `gh-${pullRequest.id}-${evaluationAttempt}-${template.id}`,
        });

        results.push({ template: templateName, result });
      } catch (error) {
        logger.error(
          `Evaluation failed for template ${templateName}`,
          error,
        );
        results.push({
          template: templateName,
          error: safeErrorMessage(error),
          result: { status: "failed" },
        });
      }
    }

    return results;
  }

  async handleMainPush(context) {
    const { repository } = context.payload;

    try {
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );
      const configRecord = await this.getEvaluationConfig(
        octokit,
        repository,
        context.payload.after,
      );

      if (!configRecord || !configRecord.config.benchmark_on_main) {
        return;
      }

      const { config } = configRecord;
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
    for (const path of CONFIG_PATHS) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          ...repositoryCoordinates(repository),
          path,
          ref: sha,
        });

        if (data.type === "file" && data.content) {
          const content = Buffer.from(data.content, "base64").toString();
          return { config: yaml.load(content) || {}, path };
        }
      } catch (error) {
        if (error.status === 404) continue;
        throw new Error(`Unable to read ${path}: ${safeErrorMessage(error)}`);
      }
    }

    logger.info("No AuraOne config found");
    return null;
  }

  async createAgentBundle(octokit, repository, pullRequest) {
    const { owner, repo } = repositoryCoordinates(repository);
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/archive/${encodeURIComponent(pullRequest.head.sha)}.tar.gz`;
  }

  async startCheckRun(octokit, repository, sha, pullRequestId) {
    const coordinates = repositoryCoordinates(repository);
    const externalId = `auraone-pr-${pullRequestId}-${sha}`;
    const { data: existing } = await octokit.rest.checks.listForRef({
      ...coordinates,
      ref: sha,
      check_name: CHECK_NAME,
      filter: "latest",
      per_page: 100,
    });
    const existingCheck = existing.check_runs.find(
      (check) => check.external_id === externalId,
    );

    let checkRunId;
    if (existingCheck) {
      checkRunId = existingCheck.id;
      await octokit.rest.checks.update({
        ...coordinates,
        check_run_id: checkRunId,
        status: "queued",
        output: {
          title: "AuraOne evaluation queued",
          summary: "Waiting to start evaluation for this commit.",
        },
      });
    } else {
      const { data } = await octokit.rest.checks.create({
        ...coordinates,
        name: CHECK_NAME,
        head_sha: sha,
        status: "queued",
        external_id: externalId,
        output: {
          title: "AuraOne evaluation queued",
          summary: "Waiting to start evaluation for this commit.",
        },
      });
      checkRunId = data.id;
    }

    await this.markCheckRunInProgress(octokit, repository, checkRunId);
    return checkRunId;
  }

  async markCheckRunInProgress(octokit, repository, checkRunId) {
    await octokit.rest.checks.update({
      ...repositoryCoordinates(repository),
      check_run_id: checkRunId,
      status: "in_progress",
      started_at: new Date().toISOString(),
      output: {
        title: "AuraOne evaluation in progress",
        summary:
          "Running the configured AuraOne templates for this pull request commit.",
      },
    });
  }

  async completeCheckRun(octokit, repository, checkRunId, report) {
    const parameters = {
      ...repositoryCoordinates(repository),
      check_run_id: checkRunId,
      status: "completed",
      conclusion: report.conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: report.title,
        summary: report.summary,
        text: report.text,
      },
      actions: [
        {
          label: "Run again",
          description: "Run the AuraOne evaluation again",
          identifier: "rerun",
        },
      ],
    };

    if (report.detailsUrl) {
      parameters.details_url = report.detailsUrl;
    }

    await octokit.rest.checks.update(parameters);
  }

  renderCheckSummary(report) {
    const score =
      report.score === null ? "Not available" : formatPercent(report.score);

    return [
      `**Decision:** ${escapeMarkdownCell(report.decision)}`,
      `**Score:** ${escapeMarkdownCell(score)}`,
      `**Required threshold:** ${formatPercent(report.threshold)}`,
      `**Evaluated commit:** \`${escapeMarkdownCell(report.sha)}\``,
      `**Configuration:** \`${escapeMarkdownCell(report.configPath)}\``,
    ].join("  \n");
  }

  renderCheckText(report, repository) {
    const sections = [];
    const sourceUrl = configUrl(
      repository,
      report.sha,
      report.configPath.startsWith(".") ? report.configPath : null,
    );

    if (report.error) {
      sections.push(
        `### Error\n\n${escapeMarkdownCell(report.error)}`,
      );
    }

    sections.push(`### Template evidence\n\n${renderResultTable(report.results)}`);
    sections.push(
      `### Next step\n\n${escapeMarkdownCell(report.remediation)}`,
    );

    if (sourceUrl) {
      sections.push(
        `### Configuration\n\n[Inspect \`${escapeMarkdownCell(
          report.configPath,
        )}\`](${sourceUrl}) in the evaluated commit.`,
      );
    }

    sections.push(
      "### Documentation\n\n[Configure AuraOne evaluations](https://github.com/auraoneai/github-app#repository-config).",
    );
    return limitMarkdown(sections.join("\n\n"));
  }

  renderEvaluationComment(report) {
    const score =
      report.score === null ? "Not available" : formatPercent(report.score);

    return limitMarkdown([
      COMMENT_MARKER,
      "## AuraOne evaluation",
      "",
      `**Decision:** ${escapeMarkdownCell(report.decision)}  `,
      `**Score:** ${escapeMarkdownCell(score)}  `,
      `**Required threshold:** ${formatPercent(report.threshold)}  `,
      `**Evaluated commit:** \`${escapeMarkdownCell(report.sha)}\`  `,
      `**Configuration:** \`${escapeMarkdownCell(report.configPath)}\``,
      "",
      renderResultTable(report.results, false),
      "",
      "### Next step",
      "",
      escapeMarkdownCell(report.remediation),
      "",
      "_This comment is updated in place when AuraOne evaluates a newer commit._",
    ].join("\n"));
  }

  async publishEvaluationComment(
    octokit,
    repository,
    pullRequest,
    report,
    enabled = true,
  ) {
    try {
      await this.upsertEvaluationComment(
        octokit,
        repository,
        pullRequest,
        report,
        enabled,
      );
    } catch (error) {
      logger.warn("Unable to publish optional pull request summary", {
        error: safeErrorMessage(error),
        pullRequest: pullRequest.number,
      });
    }
  }

  async upsertEvaluationComment(
    octokit,
    repository,
    pullRequest,
    report,
    enabled = true,
  ) {
    if (!enabled) return;

    const coordinates = repositoryCoordinates(repository);
    const listParameters = {
      ...coordinates,
      issue_number: pullRequest.number,
      per_page: 100,
    };
    const comments =
      typeof octokit.paginate === "function"
        ? await octokit.paginate(
            octokit.rest.issues.listComments,
            listParameters,
          )
        : (await octokit.rest.issues.listComments(listParameters)).data;
    const existing = comments.find(
      (comment) =>
        comment.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.includes(COMMENT_MARKER),
    );
    const body = this.renderEvaluationComment(report);

    if (existing) {
      await octokit.rest.issues.updateComment({
        ...coordinates,
        comment_id: existing.id,
        body,
      });
      return;
    }

    await octokit.rest.issues.createComment({
      ...coordinates,
      issue_number: pullRequest.number,
      body,
    });
  }

  getDetailsUrl(evaluationId) {
    if (!evaluationId) return null;
    const baseUrl = this.auraClient.baseUrl || "https://api.auraone.ai";
    return `${baseUrl.replace(/\/api\/?$/, "")}/evaluations/${encodeURIComponent(
      evaluationId,
    )}`;
  }

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
module.exports.escapeMarkdownCell = escapeMarkdownCell;
module.exports.COMMENT_MARKER = COMMENT_MARKER;

if (require.main === module) {
  const app = new AuraGitHubApp();
  app.createServer();
}
