"use strict";

const COMMENT_MARKER = "<!-- auraone-eval-gate -->";
const LEGACY_COMMENT_MARKER = "<!-- auraone-evaluation-summary -->";

function repositoryCoordinates(repository) {
  return {
    owner: repository.owner.login,
    repo: repository.name,
  };
}

/**
 * Returns true only when a comment is authored by a Bot and contains the
 * AuraOne eval-gate marker (or legacy summary marker). User-authored comments
 * are never matched even if a user pastes the marker into their comment body.
 */
function isAppOwnedEvaluationComment(comment) {
  if (!comment || comment.user?.type !== "Bot") {
    return false;
  }
  if (typeof comment.body !== "string") {
    return false;
  }
  return (
    comment.body.includes(COMMENT_MARKER) ||
    comment.body.includes(LEGACY_COMMENT_MARKER)
  );
}

function findExistingEvaluationComment(comments) {
  if (!Array.isArray(comments)) return undefined;
  return comments.find((comment) => isAppOwnedEvaluationComment(comment));
}

async function upsertMarkerComment(
  octokit,
  repository,
  pullRequest,
  body,
  enabled = true,
) {
  if (!enabled) return null;

  const coordinates = repositoryCoordinates(repository);
  const issueNumber =
    typeof pullRequest === "number" ? pullRequest : pullRequest.number;
  const listParameters = {
    ...coordinates,
    issue_number: issueNumber,
    per_page: 100,
  };
  let comments = [];
  if (typeof octokit.paginate === "function") {
    comments = await octokit.paginate(
      octokit.rest.issues.listComments,
      listParameters,
    );
  } else if (typeof octokit.rest?.issues?.listComments === "function") {
    const response = await octokit.rest.issues.listComments(listParameters);
    comments = response?.data || [];
  }

  const existing = findExistingEvaluationComment(comments);
  const markedBody = body.includes(COMMENT_MARKER)
    ? body
    : `${COMMENT_MARKER}\n${body}`;

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...coordinates,
      comment_id: existing.id,
      body: markedBody,
    });
    return { action: "updated", commentId: existing.id };
  }

  const created = await octokit.rest.issues.createComment({
    ...coordinates,
    issue_number: issueNumber,
    body: markedBody,
  });
  return { action: "created", commentId: created?.data?.id ?? null };
}

module.exports = {
  COMMENT_MARKER,
  LEGACY_COMMENT_MARKER,
  isAppOwnedEvaluationComment,
  findExistingEvaluationComment,
  upsertMarkerComment,
};
