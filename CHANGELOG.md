# Changelog

All notable changes to `@auraone/github-app` are documented here.

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

- Distributed as source for self-hosting. A hosted version is available via the AuraOne dashboard.
