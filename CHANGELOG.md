# Changelog

All notable changes to `@auraone/github-app` are documented here.

## [Unreleased]

No changes yet.

## [1.0.0] - 2026-10-18

Published to npm on 2026-10-18 from the AuraOne monorepo release commit
`9b9548c1993477b792f8000a93854a6313cfe450`, which npm records as the package
`gitHead`. This repository mirrors that package source: the `v1.0.0` tag
carries the same files as `sdks/github-app` at that commit.

### Breaking

- The AuraOne API key must be a platform-issued `ak_<8 hex>_<64 hex>` key;
  `aura_live_*` and `aura_test_*` keys fail at startup.
- `GITHUB_WEBHOOK_SECRET` is required; the app refuses to start without it.
- `@auraone/sdk` moved from a runtime dependency to a required peer
  dependency (`>=1.0.0`), so evaluations use the `@auraone/sdk` 1.0.0
  `/api/...` contract.

### Added

- Base-branch regression check: the configured templates also run against
  the pull request's base commit, and the Check Run fails when a template
  score drops more than `regression_tolerance` below its base-branch score.
  Set `compare_to_base: false` to skip it.
- Private repositories: the agent bundle URL comes from the installation
  token's signed tarball redirect instead of the public archive URL.
- An `app.yml` GitHub App manifest requesting Checks, Issues, Pull requests,
  and Commit statuses write, Contents read, and the `pull_request`,
  `check_run`, and `push` events.

### Changed

- The legacy `AURA_API_KEY` and `AURA_ORG_ID` names log a deprecation
  warning; use `AURAONE_API_KEY` and `AURAONE_ORG_ID`.
- Check Run lifecycle and marker-comment handling moved into
  `src/check-runs.js` and `src/marker-comment.js`. Commit statuses
  (`auraone/evaluation`) are posted only when the installation client has no
  Checks API.
- The `dev` script uses `node --watch` instead of `nodemon`.

### Notes

- The packaged README describes commit statuses and a `.aura-one.yml` file.
  The 1.0.0 code reports through Check Runs (commit statuses only as a
  fallback) and reads `.auraone.yml` or `.auraone.yaml`.
- The package's `repository` field points at the AuraOne monorepo
  (`sdks/github-app`), which is not public; this repository is the public
  source.
- This release was built and published from the monorepo, not by this
  repository's `release-npm.yml` workflow. It has no npm provenance
  attestation and no GitHub Release assets.

## [0.2.0] - 2026-07-13

This release is prepared in source. Publication is recorded separately and is
not implied by this changelog entry.

### Added

- Added lifecycle Check Runs with queued, in-progress, passed, failed, skipped,
  action-required, and error presentation.
- Added a **Run again** Check Run action that reevaluates the associated pull
  request without requiring a new commit.
- Added deterministic npm release automation using a lockfile, trusted
  publishing, release-tag validation, package inspection, and provenance.

### Changed

- Reworked the README and npm metadata around repository-owner discovery,
  source-first self-hosting, exact permissions and webhooks, runtime/data
  boundaries, evidence/remediation output, deployment proof, release proof,
  limitations, and a concrete first workflow.
- Raised the declared Node.js runtime floor from 16 to 18 to match the current
  Octokit dependency requirements.
- Replaced legacy commit statuses with `AuraOne evaluation` Check Runs that
  include the decision, score, threshold, commit, configuration path,
  template-level evidence, exact details URL, and remediation guidance.
- Changed pull request reporting to update one app-owned summary comment in
  place; repositories can disable the comment with `pr_comment: false`.
- Escaped configuration and API-derived Markdown content before publishing it
  to GitHub.

## [0.1.1] - 2026-07-07

### Changed

- Reworked README, npm metadata, and package contents for the public npm package.
- Documented install-first setup, GitHub App webhook usage, repository config, and package limitations.
- Added support for `AURAONE_API_KEY`, `AURAONE_BASE_URL`, and `AURAONE_ORG_ID` environment variable names while preserving existing `AURA_*` aliases.

## [0.1.0] - 2026-05-11

Initial public release.

### Added

- Probot-based GitHub App that listens for `pull_request` events.
- Configuration via `.auraone.yml` (or `.auraone.yaml`) in the target repository.
- Posts a `auraone/evaluation` Check Run with run status, score, and a link to the evidence record.
- Optional merge-block via configurable threshold.
- Uses `@auraone/sdk` for hosted API access.

### Notes

- Distributed as source for self-hosting.
