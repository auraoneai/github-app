# Changelog

All notable changes to `@auraone/github-app` are documented here.

## [Unreleased]

No changes yet.

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
