"use strict";

const CHECK_NAME = "AuraOne evaluation";

function repositoryCoordinates(repository) {
  return {
    owner: repository.owner.login,
    repo: repository.name,
  };
}

/**
 * Build a deterministic Check Run external_id keyed on commit SHA and
 * optional webhook delivery ID (with pullRequestId when present).
 */
function buildCheckRunExternalId({ pullRequestId, sha, deliveryId }) {
  const prefix = pullRequestId
    ? `auraone-pr-${pullRequestId}-${sha}`
    : `auraone-${sha}`;
  return deliveryId ? `${prefix}-${deliveryId}` : prefix;
}

function matchesCheckRunExternalId(check, { pullRequestId, sha, deliveryId }) {
  if (!check || typeof check.external_id !== "string") return false;
  const exact = buildCheckRunExternalId({ pullRequestId, sha, deliveryId });
  const base = pullRequestId
    ? `auraone-pr-${pullRequestId}-${sha}`
    : `auraone-${sha}`;
  return (
    check.external_id === exact ||
    check.external_id === base ||
    check.external_id.startsWith(`${base}-`)
  );
}

async function startCheckRun(
  octokit,
  repository,
  sha,
  pullRequestId,
  deliveryId,
) {
  const coordinates = repositoryCoordinates(repository);
  const externalId = buildCheckRunExternalId({
    pullRequestId,
    sha,
    deliveryId,
  });
  const { data: existing } = await octokit.rest.checks.listForRef({
    ...coordinates,
    ref: sha,
    check_name: CHECK_NAME,
    filter: "latest",
    per_page: 100,
  });
  const existingCheck = (existing?.check_runs || []).find((check) =>
    matchesCheckRunExternalId(check, { pullRequestId, sha, deliveryId }),
  );

  let checkRunId;
  if (existingCheck) {
    checkRunId = existingCheck.id;
    await octokit.rest.checks.update({
      ...coordinates,
      check_run_id: checkRunId,
      status: "queued",
      external_id: externalId,
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

  await markCheckRunInProgress(octokit, repository, checkRunId);
  return checkRunId;
}

async function markCheckRunInProgress(octokit, repository, checkRunId) {
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

async function completeCheckRun(octokit, repository, checkRunId, report) {
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

module.exports = {
  CHECK_NAME,
  repositoryCoordinates,
  buildCheckRunExternalId,
  matchesCheckRunExternalId,
  startCheckRun,
  markCheckRunInProgress,
  completeCheckRun,
};
