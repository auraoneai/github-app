"use strict";

const {
  COMMENT_MARKER,
  isAppOwnedEvaluationComment,
  upsertMarkerComment,
} = require("../marker-comment");

const repository = {
  owner: { login: "auraoneai" },
  name: "agent-repo",
};
const pullRequest = { number: 12 };

describe("Marker-owned PR comment (OSS-05)", () => {
  test("uses <!-- auraone-eval-gate --> marker", () => {
    expect(COMMENT_MARKER).toBe("<!-- auraone-eval-gate -->");
  });

  test("never matches user-authored comments even when they contain the marker", () => {
    expect(
      isAppOwnedEvaluationComment({
        id: 1,
        user: { type: "User" },
        body: `${COMMENT_MARKER}\nUser spoofed comment`,
      }),
    ).toBe(false);

    expect(
      isAppOwnedEvaluationComment({
        id: 2,
        user: { type: "Bot" },
        body: `${COMMENT_MARKER}\nBot evaluation summary`,
      }),
    ).toBe(true);
  });

  test("updates existing bot-owned comment in place without touching user comments", async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: jest.fn(async () => ({
            data: [
              {
                id: 100,
                user: { type: "User" },
                body: `${COMMENT_MARKER}\nUser comment that must never be overwritten`,
              },
              {
                id: 200,
                user: { type: "Bot" },
                body: `${COMMENT_MARKER}\nPrevious bot evaluation`,
              },
            ],
          })),
          updateComment: jest.fn(async () => ({ data: { id: 200 } })),
          createComment: jest.fn(async () => ({ data: { id: 300 } })),
        },
      },
    };

    const result = await upsertMarkerComment(
      octokit,
      repository,
      pullRequest,
      "## Updated report",
    );

    expect(result).toEqual({ action: "updated", commentId: 200 });
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "auraoneai",
      repo: "agent-repo",
      comment_id: 200,
      body: `${COMMENT_MARKER}\n## Updated report`,
    });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  test("creates a new marker-owned comment when only user comments exist", async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: jest.fn(async () => ({
            data: [
              {
                id: 100,
                user: { type: "User" },
                body: `${COMMENT_MARKER}\nUser comment`,
              },
            ],
          })),
          updateComment: jest.fn(async () => ({ data: {} })),
          createComment: jest.fn(async () => ({ data: { id: 301 } })),
        },
      },
    };

    const result = await upsertMarkerComment(
      octokit,
      repository,
      pullRequest,
      "## First bot report",
    );

    expect(result).toEqual({ action: "created", commentId: 301 });
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "auraoneai",
      repo: "agent-repo",
      issue_number: 12,
      body: `${COMMENT_MARKER}\n## First bot report`,
    });
  });
});
