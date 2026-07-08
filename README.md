# @auraone/github-app

Run AuraOne AI agent evaluations from a self-hosted Node.js GitHub App and report the result directly on pull requests.

[![npm version](https://img.shields.io/npm/v/@auraone/github-app.svg)](https://www.npmjs.com/package/@auraone/github-app)
[![npm downloads](https://img.shields.io/npm/dm/@auraone/github-app.svg)](https://www.npmjs.com/package/@auraone/github-app)
[![license](https://img.shields.io/npm/l/@auraone/github-app.svg)](./LICENSE)
[![CI](https://github.com/auraoneai/github-app/actions/workflows/ci.yml/badge.svg)](https://github.com/auraoneai/github-app/actions/workflows/ci.yml)

- Turn `.auraone.yml` pull request rules into GitHub commit statuses and review comments.
- Trigger hosted AuraOne evaluation templates whenever a PR opens or changes.
- Add a score-based merge gate without wiring custom GitHub API calls into every repository.
- Self-host the webhook service while keeping evaluation execution in the AuraOne API.

## Install

```bash
npm install @auraone/github-app
```

## Quickstart

Create a small server entry point:

```js
const AuraGitHubApp = require("@auraone/github-app");

const app = new AuraGitHubApp();
app.createServer(process.env.PORT || 3000);
```

Set the required environment variables:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_PRIVATE_KEY="$(cat private-key.pem)"
export GITHUB_WEBHOOK_SECRET="github-webhook-secret"
export AURAONE_API_KEY="auraone-api-key"

node server.js
```

Then add `.auraone.yml` to a repository where the GitHub App is installed:

```yaml
pass_threshold: 0.85
templates:
  - id: rubric.web.qa
    name: Web QA
    reward_spec_id: qa-regression
    config:
      fail_on_threshold: true
```

When a pull request opens or updates, the app reads that file, starts each configured AuraOne evaluation, posts a `auraone/evaluation` commit status, and adds a summary comment to the PR.

## What You Can Build

- A self-hosted AI evaluation gate for pull requests.
- Repository-level AuraOne evaluation policies stored in `.auraone.yml`.
- Main-branch benchmark runs when `benchmark_on_main` and `benchmark_templates` are configured.
- Review comments that summarize template scores and link back to the AuraOne evidence record.

## Why @auraone/github-app?

- **GitHub-native review feedback.** Developers see pass/fail status and score summaries in the same PR surface they already use.
- **Config lives with code.** Each repository can choose its own AuraOne templates, thresholds, and benchmark behavior.
- **Self-hosted webhook control.** You own the GitHub App deployment, secrets, and webhook endpoint while AuraOne runs the evaluations.
- **Less glue code.** The package handles GitHub webhook parsing, installation clients, commit statuses, and PR comments.

## Compared To GitHub Actions

| Need | `@auraone/github-app` | GitHub Actions or custom CI |
| --- | --- | --- |
| PR status and review comment integration | Built into the webhook handler | You write workflow steps or GitHub API calls |
| Per-repository evaluation config | Reads `.auraone.yml` from the PR head | Usually modeled as workflow YAML or action inputs |
| Central app deployment across repos | One GitHub App installation flow | One workflow per repository |
| Arbitrary build/test automation | Not the focus | Better fit |

Use GitHub Actions if you need general-purpose CI jobs. Use this package when the job is specifically to connect AuraOne evaluations to GitHub pull request checks from a self-hosted app.

## API And Usage

The package exports the `AuraGitHubApp` class from `src/app.js`.

```js
const AuraGitHubApp = require("@auraone/github-app");

const app = new AuraGitHubApp({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_PRIVATE_KEY,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  auraApiKey: process.env.AURAONE_API_KEY,
  auraBaseUrl: process.env.AURAONE_BASE_URL,
  orgId: process.env.AURAONE_ORG_ID,
});

app.createServer(3000);
```

### Constructor Options

| Option | Environment variable | Required | Purpose |
| --- | --- | --- | --- |
| `appId` | `GITHUB_APP_ID` | Yes | GitHub App ID. |
| `privateKey` | `GITHUB_PRIVATE_KEY` | Yes | GitHub App private key PEM. |
| `webhookSecret` | `GITHUB_WEBHOOK_SECRET` | Yes | Secret used to verify GitHub webhooks. |
| `auraApiKey` | `AURAONE_API_KEY` | Yes | AuraOne API key used to create evaluation runs. |
| `auraBaseUrl` | `AURAONE_BASE_URL` | No | AuraOne API URL. Defaults to `https://api.auraone.ai`. |
| `orgId` | `AURAONE_ORG_ID` | No | AuraOne organization identifier passed to the SDK. |

The legacy aliases `AURA_API_KEY`, `AURA_BASE_URL`, and `AURA_ORG_ID` are also accepted.

### Webhook Endpoint

`createServer()` starts a Node HTTP server with:

- `GET /health` for health checks.
- `POST /api/github/webhooks` for GitHub App webhooks.

### Repository Config

The app looks for `.auraone.yml` first and `.auraone.yaml` second.

```yaml
pass_threshold: 0.8
templates:
  - id: rubric.web.qa
    name: Web QA
    reward_spec_id: qa-regression
    config:
      browser: chromium

benchmark_on_main: true
benchmark_templates:
  - id: rubric.web.qa
    reward_spec_id: qa-regression
    config:
      benchmark: true
```

## Examples

### Local Development

```bash
git clone https://github.com/auraoneai/github-app.git
cd github-app
npm install
GITHUB_APP_ID="123456" \
GITHUB_PRIVATE_KEY="$(cat private-key.pem)" \
GITHUB_WEBHOOK_SECRET="github-webhook-secret" \
AURAONE_API_KEY="auraone-api-key" \
npm start
```

For local webhook testing, expose port `3000` with a tunnel such as `ngrok` and set your GitHub App webhook URL to:

```text
https://your-tunnel.example.com/api/github/webhooks
```

## Compatibility And Limitations

- Requires Node.js 16 or newer.
- Designed for server-side Node.js deployments; browser builds are not supported.
- Requires a GitHub App with webhook access to pull request and push events.
- Requires AuraOne API credentials and evaluation templates created in AuraOne.
- `createAgentBundle()` currently sends the GitHub archive URL for the PR head. If your evaluation needs a custom build artifact, extend that method in your deployment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports should follow [SECURITY.md](SECURITY.md). Release notes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
