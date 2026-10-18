"use strict";

const {
  CHECK_NAME,
  buildCheckRunExternalId,
  matchesCheckRunExternalId,
  startCheckRun,
  completeCheckRun,
} = require("../check-runs");

const repository = {
  owner: { login: "auraoneai" },
  name: "agent-repo",
};

function makeOctokit(existingRuns = []) {
  return {
    rest: {
      checks: {
        listForRef: jest.fn(async () => ({
          data: { check_runs: existingRuns },
        })),
        create: jest.fn(async () => ({ data: { id: 901 } })),
        update: jest.fn(async () => ({ data: {} })),
      },
    },
  };
}

describe("Check Run lifecycle (OSS-05)", () => {
  test("keys external_id on pullRequestId, commit SHA, and webhook delivery ID", () => {
    expect(
      buildCheckRunExternalId({
        pullRequestId: 42,
        sha: "deadbeef",
        deliveryId: "deliv-1",
      }),
    ).toBe("auraone-pr-42-deadbeef-deliv-1");

    expect(
      buildCheckRunExternalId({
        pullRequestId: 42,
        sha: "deadbeef",
      }),
    ).toBe("auraone-pr-42-deadbeef");
  });

  test("transitions Check Run through queued -> in_progress -> completed", async () => {
    const octokit = makeOctokit();
    const checkRunId = await startCheckRun(
      octokit,
      repository,
      "deadbeef",
      42,
      "deliv-9",
    );

    expect(checkRunId).toBe(901);
    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "auraoneai",
        repo: "agent-repo",
        name: CHECK_NAME,
        head_sha: "deadbeef",
        status: "queued",
        external_id: "auraone-pr-42-deadbeef-deliv-9",
      }),
    );

    expect(octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 901,
        status: "in_progress",
      }),
    );

    await completeCheckRun(octokit, repository, checkRunId, {
      conclusion: "success",
      title: "AuraOne evaluation passed",
      summary: "All checks green",
      text: "Detailed evidence",
      detailsUrl: "https://app.auraone.ai/evaluations/eval_1",
    });

    expect(octokit.rest.checks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        check_run_id: 901,
        status: "completed",
        conclusion: "success",
        details_url: "https://app.auraone.ai/evaluations/eval_1",
      }),
    );
  });

  test("reuses an existing Check Run for the same commit and PR instead of duplicating", async () => {
    const existing = [
      {
        id: 777,
        external_id: "auraone-pr-42-deadbeef-deliv-1",
      },
    ];
    expect(
      matchesCheckRunExternalId(existing[0], {
        pullRequestId: 42,
        sha: "deadbeef",
        deliveryId: "deliv-2",
      }),
    ).toBe(true);

    const octokit = makeOctokit(existing);
    const checkRunId = await startCheckRun(
      octokit,
      repository,
      "deadbeef",
      42,
      "deliv-2",
    );

    expect(checkRunId).toBe(777);
    expect(octokit.rest.checks.create).not.toHaveBeenCalled();
    expect(octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 777,
        status: "queued",
      }),
    );
  });
});
