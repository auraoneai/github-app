/**
 * AuraOne GitHub App
 * Automated evaluation runs on pull request changes.
 */

const { App } = require("@octokit/app");
const { AuraOneClient } = require("@auraone/sdk");
const yaml = require("js-yaml");

const {
  CHECK_NAME,
  repositoryCoordinates,
  buildCheckRunExternalId,
  matchesCheckRunExternalId,
  startCheckRun: startCheckRunLifecycle,
  markCheckRunInProgress: markCheckRunInProgressLifecycle,
  completeCheckRun: completeCheckRunLifecycle,
} = require("./check-runs");
const {
  COMMENT_MARKER,
  LEGACY_COMMENT_MARKER,
  isAppOwnedEvaluationComment,
  findExistingEvaluationComment,
  upsertMarkerComment,
} = require("./marker-comment");

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

function normalizeRegressionTolerance(value) {
  const tolerance = Number(value ?? 0);
  if (!Number.isFinite(tolerance)) {
    throw new Error("`regression_tolerance` must be a number from 0 to 1.");
  }
  return clamp(tolerance, 0, 1);
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

function compareResultsToBaseline(results, baselineResults, tolerance) {
  const baselineByTemplate = new Map();
  for (const entry of baselineResults || []) {
    baselineByTemplate.set(entry.template, entry);
  }

  const rows = results.map(({ template, result }) => {
    const baseline = baselineByTemplate.get(template);
    const score = Number(result?.score);
    const baselineScore = Number(baseline?.result?.score);
    const hasScore = Number.isFinite(score);
    const hasBaseline = Number.isFinite(baselineScore);
    return {
      template,
      score: hasScore ? score : null,
      baselineScore: hasBaseline ? baselineScore : null,
      regressed:
        hasScore && hasBaseline ? score < baselineScore - tolerance : null,
    };
  });

  const comparable = rows.filter((row) => row.regressed !== null);
  const regressedTemplates = rows
    .filter((row) => row.regressed === true)
    .map((row) => row.template);

  return {
    rows,
    comparableCount: comparable.length,
    regressed: regressedTemplates.length > 0,
    regressedTemplates,
  };
}

function renderBaselineTable(comparison) {
  if (!comparison || !comparison.rows || comparison.rows.length === 0) {
    return null;
  }

  const rows = comparison.rows
    .map((row) => {
      const base =
        row.baselineScore === null ? "Not available" : formatPercent(row.baselineScore);
      const head =
        row.score === null ? "Not available" : formatPercent(row.score);
      const delta =
        row.score === null || row.baselineScore === null
          ? "—"
          : `${row.score - row.baselineScore >= 0 ? "+" : ""}${formatPercent(
              row.score - row.baselineScore,
            )}`;
      const flag = row.regressed === true ? " ⚠" : "";
      return `| ${escapeMarkdownCell(row.template)} | ${base} | ${head} | ${escapeMarkdownCell(delta)}${flag} |`;
    })
    .join("\n");

  return `| Template | Base-branch score | PR score | Δ |\n| --- | ---: | ---: | ---: |\n${rows}`;
}

function evaluationDecision(results, score, threshold, baseline) {
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

  if (baseline && baseline.regressed) {
    const regressedNames = baseline.regressedTemplates
      .map((template) => `\`${template}\``)
      .join(", ");
    return {
      label: "Regression detected",
      conclusion: "failure",
      remediation: `The pull request score dropped below the base-branch score for ${regressedNames}. Review the template evidence below, restore the regressed behavior, and push an updated commit or use **Run again** after the evidence changes.`,
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
    const webhookSecret =
      options.webhookSecret !== undefined
        ? options.webhookSecret
        : process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret || !String(webhookSecret).trim()) {
      throw new Error(
        "GITHUB_WEBHOOK_SECRET is required — without it webhook payloads " +
          "cannot be signature-verified",
      );
    }

    let apiKey =
      options.auraApiKey !== undefined
        ? options.auraApiKey
        : process.env.AURAONE_API_KEY;
    if (!apiKey && process.env.AURA_API_KEY) {
      logger.warn("AURA_API_KEY is deprecated; set AURAONE_API_KEY instead");
      apiKey = process.env.AURA_API_KEY;
    }
    if (
      !apiKey ||
      (options.auraApiKey !== undefined && !String(apiKey).startsWith("ak_")) ||
      String(apiKey).startsWith("aura_live_") ||
      String(apiKey).startsWith("aura_test_")
    ) {
      throw new Error(
        "AURAONE_API_KEY must be a platform-issued ak_<8hex>_<64hex> key",
      );
    }

    let orgId =
      options.orgId || process.env.AURAONE_ORG_ID || process.env.AURA_ORG_ID;
    if (!options.orgId && !process.env.AURAONE_ORG_ID && process.env.AURA_ORG_ID) {
      logger.warn("AURA_ORG_ID is deprecated; set AURAONE_ORG_ID instead");
    }
    this.orgId = orgId || null;

    this.githubApp = new App({
      appId: options.appId || process.env.GITHUB_APP_ID,
      privateKey: options.privateKey || process.env.GITHUB_PRIVATE_KEY,
      webhooks: {
        secret: webhookSecret,
      },
    });

    const baseUrl =
      options.auraBaseUrl ||
      process.env.AURAONE_BASE_URL ||
      process.env.AURA_BASE_URL ||
      "https://api.auraone.ai";

    this.auraClient = new AuraOneClient({
      apiKey,
      baseUrl,
      ...(options.orgId ? { orgId: options.orgId } : {}),
    });

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
    const deliveryId = context.id || context.payload?.delivery_id;

    try {
      const octokit = await this.githubApp.getInstallationOctokit(
        context.payload.installation.id,
      );
      await this.runPullRequestEvaluation(
        octokit,
        repository,
        pullRequest,
        undefined,
        deliveryId,
      );
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
          evaluationAttempt,
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

        await this.completeCheckRun(
          octokit,
          repository,
          checkRunId,
          {
            conclusion: "neutral",
            title: "AuraOne evaluation skipped",
            summary: this.renderCheckSummary(skipped),
            text: this.renderCheckText(skipped, repository),
          },
          pullRequest.head.sha,
        );
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

        await this.completeCheckRun(
          octokit,
          repository,
          checkRunId,
          {
            conclusion: "action_required",
            title: "AuraOne configuration needs a template",
            summary: this.renderCheckSummary(emptyConfig),
            text: this.renderCheckText(emptyConfig, repository),
          },
          pullRequest.head.sha,
        );
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

      const regressionTolerance = normalizeRegressionTolerance(
        config.regression_tolerance,
      );
      const baselineComparison = await this.compareWithBaseBranch(
        octokit,
        repository,
        pullRequest,
        config,
        templates,
        results,
        evaluationAttempt,
        regressionTolerance,
      );

      const decision = evaluationDecision(
        results,
        overallScore,
        threshold,
        baselineComparison,
      );
      const report = {
        decision: decision.label,
        score: overallScore,
        threshold,
        sha: pullRequest.head.sha,
        configPath,
        results,
        baseline: baselineComparison,
        remediation: decision.remediation,
      };
      const detailsUrl = this.getDetailsUrl(
        results.find(({ result }) => result?.id)?.result.id,
      );

      await this.completeCheckRun(
        octokit,
        repository,
        checkRunId,
        {
          conclusion: decision.conclusion,
          title: `AuraOne evaluation ${decision.label.toLowerCase()}`,
          summary: this.renderCheckSummary(report),
          text: this.renderCheckText(report, repository),
          detailsUrl,
        },
        pullRequest.head.sha,
      );
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
          await this.completeCheckRun(
            octokit,
            repository,
            checkRunId,
            {
              conclusion: "failure",
              title: "AuraOne evaluation error",
              summary: this.renderCheckSummary(report),
              text: this.renderCheckText(report, repository),
            },
            pullRequest.head.sha,
          );
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
    const attemptKey = evaluationAttempt || pullRequest.head.sha;
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
          idempotencyKey: `gh-${pullRequest.id}-${attemptKey}-${template.id}`,
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

  /**
   * Regression detection (H7): re-runs the configured templates against the
   * pull request's base-branch commit and compares per-template scores. A
   * template regresses when its PR score drops more than `tolerance` below
   * the base-branch score. Opt out with `compare_to_base: false`.
   */
  async compareWithBaseBranch(
    octokit,
    repository,
    pullRequest,
    config,
    templates,
    headResults,
    evaluationAttempt,
    tolerance,
  ) {
    const baseSha = pullRequest.base?.sha;

    if (config.compare_to_base === false) {
      return {
        status: "disabled",
        baseSha: baseSha || null,
        rows: [],
        regressed: false,
        regressedTemplates: [],
      };
    }

    if (!baseSha) {
      return {
        status: "skipped",
        baseSha: null,
        rows: [],
        regressed: false,
        regressedTemplates: [],
      };
    }

    try {
      const baseBundleUrl = await this.createAgentBundle(octokit, repository, {
        head: { sha: baseSha },
      });
      const baselineResults = await this.runEvaluations(
        templates,
        baseBundleUrl,
        { id: pullRequest.id, head: { sha: baseSha } },
        `${evaluationAttempt || pullRequest.head.sha}-base`,
      );
      const comparison = compareResultsToBaseline(
        headResults,
        baselineResults,
        tolerance,
      );
      return {
        status:
          comparison.comparableCount > 0 ? "completed" : "inconclusive",
        baseSha,
        ...comparison,
      };
    } catch (error) {
      logger.error(
        "Baseline evaluation failed; regression check inconclusive",
        error,
      );
      return {
        status: "unavailable",
        baseSha,
        error: safeErrorMessage(error),
        rows: [],
        comparableCount: 0,
        regressed: false,
        regressedTemplates: [],
      };
    }
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
        if (error.status === 404 || error.message === "404") continue;
        throw new Error(`Unable to read ${path}: ${safeErrorMessage(error)}`);
      }
    }

    logger.info("No AuraOne config found");
    return null;
  }

  async createAgentBundle(octokit, repository, pullRequest) {
    const { owner, repo } = repositoryCoordinates(repository);
    const sha = pullRequest.head.sha;
    const publicArchive = `https://github.com/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/archive/${encodeURIComponent(sha)}.tar.gz`;
    if (!repository.private || typeof octokit?.auth !== "function") {
      return publicArchive;
    }

    const tarballApi = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(sha)}`;
    const { token } = await octokit.auth({ type: "installation" });
    const response = await fetch(tarballApi, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
    });
    const signedUrl = response.headers.get("location");
    if (response.status !== 302 || !signedUrl) {
      throw new Error(
        `Failed to resolve private tarball for ${repository.full_name || `${owner}/${repo}`}@${sha}: HTTP ${response.status}`,
      );
    }
    return signedUrl;
  }

  async postStatus(octokit, repository, sha, status) {
    if (typeof octokit?.rest?.repos?.createCommitStatus === "function") {
      await octokit.rest.repos.createCommitStatus({
        ...repositoryCoordinates(repository),
        sha,
        ...status,
      });
    }
  }

  async startCheckRun(octokit, repository, sha, pullRequestId, deliveryId) {
    if (!octokit?.rest?.checks) {
      await this.postStatus(octokit, repository, sha, {
        state: "pending",
        description: "AuraOne evaluation in progress...",
        context: "auraone/evaluation",
      });
      return `status-${sha}`;
    }
    return startCheckRunLifecycle(
      octokit,
      repository,
      sha,
      pullRequestId,
      deliveryId,
    );
  }

  async markCheckRunInProgress(octokit, repository, checkRunId) {
    if (!octokit?.rest?.checks) return;
    await markCheckRunInProgressLifecycle(octokit, repository, checkRunId);
  }

  async completeCheckRun(octokit, repository, checkRunId, report, sha) {
    if (!octokit?.rest?.checks) {
      if (sha) {
        const state =
          report.conclusion === "success" || report.conclusion === "neutral"
            ? "success"
            : report.conclusion === "failure"
              ? "failure"
              : "error";
        await this.postStatus(octokit, repository, sha, {
          state,
          description: report.title || "AuraOne evaluation completed",
          context: "auraone/evaluation",
          ...(report.detailsUrl ? { target_url: report.detailsUrl } : {}),
        });
      }
      return;
    }
    await completeCheckRunLifecycle(octokit, repository, checkRunId, report);
  }

  renderCheckSummary(report) {
    const score =
      report.score === null ? "Not available" : formatPercent(report.score);

    const lines = [
      `**Decision:** ${escapeMarkdownCell(report.decision)}`,
      `**Score:** ${escapeMarkdownCell(score)}`,
      `**Required threshold:** ${formatPercent(report.threshold)}`,
    ];

    if (report.baseline?.status === "completed") {
      const baselineScores = report.baseline.rows
        .map((row) => row.baselineScore)
        .filter((value) => value !== null);
      const baselineMean =
        baselineScores.length > 0
          ? baselineScores.reduce((sum, value) => sum + value, 0) /
            baselineScores.length
          : null;
      lines.push(
        `**Base-branch score:** ${
          baselineMean === null ? "Not available" : formatPercent(baselineMean)
        } (\`${escapeMarkdownCell(String(report.baseline.baseSha).slice(0, 12))}\`)`,
      );
    } else if (
      report.baseline &&
      report.baseline.status !== "disabled" &&
      report.baseline.status !== "skipped"
    ) {
      lines.push(
        `**Base-branch score:** ${escapeMarkdownCell(
          `Inconclusive (${report.baseline.status})`,
        )}`,
      );
    }

    lines.push(
      `**Evaluated commit:** \`${escapeMarkdownCell(report.sha)}\``,
      `**Configuration:** \`${escapeMarkdownCell(report.configPath)}\``,
    );

    return lines.join("  \n");
  }

  renderCheckText(report, repository) {
    const sections = [];
    const sourceUrl = configUrl(
      repository,
      report.sha,
      report.configPath.startsWith(".") ? report.configPath : null,
    );

    if (report.error) {
      sections.push(`### Error\n\n${escapeMarkdownCell(report.error)}`);
    }

    sections.push(
      `### Template evidence\n\n${renderResultTable(report.results)}`,
    );

    const baselineTable = renderBaselineTable(report.baseline);
    if (baselineTable) {
      sections.push(
        `### Base-branch regression check\n\n${baselineTable}`,
      );
    }

    sections.push(`### Next step\n\n${escapeMarkdownCell(report.remediation)}`);

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
    const baselineLine =
      report.baseline?.status === "completed"
        ? `**Base-branch score:** ${escapeMarkdownCell(
            report.baseline.rows
              .map((row) => row.baselineScore)
              .filter((value) => value !== null)
              .map((value) => formatPercent(value))
              .join(" · ") || "Not available",
          )}  `
        : null;

    return limitMarkdown(
      [
        COMMENT_MARKER,
        "## AuraOne evaluation",
        "",
        `**Decision:** ${escapeMarkdownCell(report.decision)}  `,
        `**Score:** ${escapeMarkdownCell(score)}  `,
        `**Required threshold:** ${formatPercent(report.threshold)}  `,
        ...(baselineLine ? [baselineLine] : []),
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
      ].join("\n"),
    );
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
    const body = this.renderEvaluationComment(report);
    await upsertMarkerComment(octokit, repository, pullRequest, body, enabled);
  }

  getDetailsUrl(evaluationId) {
    if (!evaluationId) return null;
    const baseUrl =
      this.auraClient.baseUrl ||
      (typeof this.auraClient.getBaseUrl === "function"
        ? this.auraClient.getBaseUrl()
        : null) ||
      "https://api.auraone.ai";
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
module.exports.compareResultsToBaseline = compareResultsToBaseline;
module.exports.evaluationDecision = evaluationDecision;
module.exports.renderBaselineTable = renderBaselineTable;
module.exports.normalizeRegressionTolerance = normalizeRegressionTolerance;
module.exports.COMMENT_MARKER = COMMENT_MARKER;
module.exports.LEGACY_COMMENT_MARKER = LEGACY_COMMENT_MARKER;
module.exports.CHECK_NAME = CHECK_NAME;
module.exports.buildCheckRunExternalId = buildCheckRunExternalId;
module.exports.matchesCheckRunExternalId = matchesCheckRunExternalId;
module.exports.isAppOwnedEvaluationComment = isAppOwnedEvaluationComment;
module.exports.findExistingEvaluationComment = findExistingEvaluationComment;

if (require.main === module) {
  const app = new AuraGitHubApp();
  app.createServer();
}
