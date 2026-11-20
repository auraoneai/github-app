# @auraone/github-app

Self-hosted GitHub App for AI evaluation Check Runs: runs AuraOne evaluation templates on pull requests and reports the result as a Check Run and a results comment.

[![npm](https://img.shields.io/npm/v/@auraone/github-app)](https://www.npmjs.com/package/@auraone/github-app)
[![CI](https://github.com/auraoneai/github-app/actions/workflows/ci.yml/badge.svg)](https://github.com/auraoneai/github-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/auraoneai/github-app/blob/main/LICENSE)

## Quick start (self-hosted)
You run this app on your own server. Register your own GitHub App from `app.yml`, then:
```bash
npm install @auraone/github-app @auraone/sdk
export GITHUB_APP_ID=... GITHUB_PRIVATE_KEY="$(cat app.pem)" GITHUB_WEBHOOK_SECRET=...
export AURAONE_API_KEY=...   # platform-issued ak_ key
node node_modules/@auraone/github-app/src/app.js   # serves POST /api/github/webhooks
```
Point the GitHub App's webhook URL at `https://<your-host>/api/github/webhooks`.

## What it does

- Receives signed `pull_request`, `check_run`, and `push` webhooks for the
  GitHub App you register.
- Runs the templates listed in the repository's `.auraone.yml` through
  `@auraone/sdk` and reports an `AuraOne evaluation` Check Run (commit
  statuses only when the Checks API is unavailable).
- Posts or updates one results comment on the pull request and supports a
  **Run again** Check Run action.
- Compares scores against the pull request's base commit and fails the
  Check Run on a regression beyond `regression_tolerance`.

## What it doesn't do

- AuraOne does not run a hosted installation of this app, and it is not a
  one-click GitHub Marketplace install. You register the GitHub App and run
  the webhook server yourself.
- It does not run evaluations itself; evaluations run on the AuraOne
  platform with your API key.
- It refuses to start without `GITHUB_WEBHOOK_SECRET`.

## Build on AuraOne

- [Python SDK](https://auraone.ai/open/sdk-python)
- [TypeScript SDK](https://auraone.ai/open/sdk-typescript)
- [Self-hosted GitHub App](https://auraone.ai/open/github-app)

## Requirements

- A platform-issued AuraOne API key (`ak_<8 hex>_<64 hex>`)
- A registered GitHub App with the manifest in `app.yml`
  (`checks:write`, `contents:read`, `statuses:write`, `pull_requests:write`, `issues:write`)

## Configuration

| Variable                | Required | Description |
| ----------------------- | -------- | ----------- |
| `GITHUB_APP_ID`         | yes      | GitHub App ID |
| `GITHUB_PRIVATE_KEY`    | yes      | App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | yes      | Webhook signing secret — startup fails without it |
| `AURAONE_API_KEY`       | yes      | Platform `ak_` API key |
| `AURAONE_ORG_ID`        | no       | Organization assertion (`?orgId=`); must equal the key's org |
| `AURA_BASE_URL`         | no       | API base (default `https://api.auraone.ai`) |
| `PORT`                  | no       | Webhook server port (default `3000`) |

The legacy `AURA_API_KEY` / `AURA_ORG_ID` names still work as a fallback
but log a deprecation warning; prefer the `AURAONE_*` names.

## Repository configuration

Place `.auraone.yml` (or `.auraone.yaml`) at the repository root:

```yaml
templates:
  - id: tpl_abc123
    name: Safety eval
    config:
      inputs:
        - prompt: "refuse unsafe requests"
          expected: "refusal"
pass_threshold: 0.8
benchmark_on_main: false
```

Each template's `config` is sent as the evaluation `config`, and
`config.inputs` is required — the platform rejects creates without it.

## Endpoints

- `POST /api/github/webhooks` — signed webhook receiver
- `GET /health` — liveness

## Test

```bash
npm ci
npm test
```

---

Move from a prototype to a production AuraOne integration. [Talk to AuraOne](https://auraone.ai/contact?from=open:github-app)
