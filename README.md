# @auraone/github-app

Self-host AuraOne pull request evaluations as one lifecycle-aware GitHub Check
Run per PR head commit and, by default, one idempotently maintained bot-owned
PR summary.

[![npm latest](https://img.shields.io/npm/v/@auraone/github-app.svg)](https://www.npmjs.com/package/@auraone/github-app)
[![CI](https://github.com/auraoneai/github-app/actions/workflows/ci.yml/badge.svg)](https://github.com/auraoneai/github-app/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **Distribution boundary:** this repository contains a self-hostable Node.js
> package. It does not provide evidence of a publicly installable hosted
> GitHub App, and the version in `package.json` is not proof that the same
> version has been published to npm. Use the release proof checks below before
> choosing a registry version.

## The Job

`@auraone/github-app` connects repository-owned `.auraone.yml` policy to the
GitHub pull request review surface:

1. Receive a signed GitHub App webhook for a new or updated pull request.
2. Read the AuraOne configuration from the exact PR head commit.
3. Ask the AuraOne API to run each configured evaluation template.
4. Move one `AuraOne evaluation` Check Run through queued, in-progress, and
   completed states.
5. Publish the decision, score, threshold, commit, template evidence, and a
   concrete remediation step.
6. Create or update one bot-owned PR summary instead of adding a new comment
   for every delivery. Set `pr_comment: false` to disable this surface.

The differentiator is the combination of one lifecycle-aware Check Run for
each evaluated PR head commit plus one idempotent bot-owned PR summary across
updates. Duplicate deliveries for the same commit reuse the Check Run's
external identity, and the summary comment is located by a private marker and
updated in place.

## Who This Is For

This package targets repository and organization owners, platform engineers,
and developer-experience teams that:

- control a GitHub App installation and its repository permissions;
- already have AuraOne API credentials and evaluation template identifiers;
- want repository-specific evaluation policy stored with the code;
- want the `AuraOne evaluation` result available as a branch-protection check;
- prefer to operate the webhook service and its secrets in their own runtime.

It is not a turnkey marketplace installation, a general-purpose CI runner, or
a replacement for build, test, deployment, and artifact workflows.

## First Useful Workflow

The shortest path to a useful result is one non-production repository and one
evaluation template:

1. Clone this repository and run the service with Node.js 18 or newer.
2. Register a private GitHub App owned by your account or organization.
3. Give that app the permissions and webhook events listed below.
4. Expose `POST /api/github/webhooks` on a public HTTPS URL and configure the
   same webhook secret in GitHub and the service.
5. Install the GitHub App on the test repository.
6. Add this file to the repository:

```yaml
# .auraone.yml
pass_threshold: 0.85
pr_comment: true
templates:
  - id: rubric.web.qa
    name: Web QA
    reward_spec_id: qa-regression
    config:
      fail_on_threshold: true
```

7. Open or update a pull request.
8. Confirm that GitHub shows one `AuraOne evaluation` Check Run and one
   bot-authored summary comment.
9. After the behavior is proven, add `AuraOne evaluation` to the repository's
   required status checks. The app does not change branch protection itself.

## Self-Hosted Setup

### Prerequisites

- Node.js 18 or newer. The current CI workflow tests Node.js 20, and the
  release workflow is configured for Node.js 22.14.
- Permission to create and install a GitHub App.
- A public HTTPS endpoint for GitHub webhook delivery.
- An AuraOne API key plus at least one valid evaluation template ID.

### Run From Source

The source checkout is the unambiguous path when repository behavior is ahead
of the npm registry:

```bash
git clone https://github.com/auraoneai/github-app.git
cd github-app
npm ci
```

Set the four required secrets and start the built-in HTTP server:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_PRIVATE_KEY="$(cat private-key.pem)"
export GITHUB_WEBHOOK_SECRET="replace-with-a-random-webhook-secret"
export AURAONE_API_KEY="replace-with-an-auraone-api-key"

export PORT="3000"
export AURAONE_BASE_URL="https://api.auraone.ai"

npm start
```

Confirm the process is serving health checks:

```bash
curl --fail --silent --show-error http://localhost:3000/health
```

The response is JSON containing `status: "healthy"` and a timestamp. For local
GitHub delivery testing, place an HTTPS tunnel in front of port `3000`. For a
production deployment, terminate TLS and route the webhook URL to:

```text
https://your-app-host.example.com/api/github/webhooks
```

Do not point the GitHub App at `/health`; that endpoint does not process
webhooks.

### Use As A Library

First verify which package version is actually available in the registry:

```bash
VERSION="$(npm view @auraone/github-app version)"
npm install "@auraone/github-app@$VERSION"
```

Then create a small server entry point:

```js
const AuraGitHubApp = require("@auraone/github-app");

const app = new AuraGitHubApp({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_PRIVATE_KEY,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  auraApiKey: process.env.AURAONE_API_KEY,
  auraBaseUrl: process.env.AURAONE_BASE_URL,
});

app.createServer(process.env.PORT || 3000);
```

`npm start` runs the equivalent source entry point from `src/app.js`.

### Constructor Options

| Option | Environment variable | Required | Current behavior |
| --- | --- | --- | --- |
| `appId` | `GITHUB_APP_ID` | Yes | Identifies the GitHub App. |
| `privateKey` | `GITHUB_PRIVATE_KEY` | Yes | Signs GitHub App authentication requests. Supply the complete PEM value. |
| `webhookSecret` | `GITHUB_WEBHOOK_SECRET` | Yes | Verifies webhook delivery signatures through Octokit's middleware. |
| `auraApiKey` | `AURAONE_API_KEY` | Yes | Authenticates AuraOne evaluation requests. |
| `auraBaseUrl` | `AURAONE_BASE_URL` | No | Defaults to `https://api.auraone.ai`. |
| `orgId` | `AURAONE_ORG_ID` | No | Accepted and stored on the app instance, but current evaluation calls do not send it to the SDK or API. |

The legacy aliases `AURA_API_KEY`, `AURA_BASE_URL`, and `AURA_ORG_ID` are also
accepted. Prefer the `AURAONE_*` names for new deployments.

## Permissions And Webhooks

The following table is derived from the REST methods and webhook handlers in
the current source. It is not verification of any live GitHub App
configuration; this repository does not include an exported app manifest or a
verified installation record.

### Repository Permissions

| Permission | Access | Why the current code needs it |
| --- | --- | --- |
| Checks | Read and write | List, create, update, complete, and rerun `AuraOne evaluation` Check Runs. Write access also enables the `requested_action` event used by **Run again**. |
| Contents | Read | Read `.auraone.yml` or `.auraone.yaml` at an exact commit and receive `push` events for optional main-branch benchmarks. |
| Pull requests | Read | Receive pull request events and fetch the current pull request when **Run again** is selected. |
| Issues | Read and write | List, create, and update the PR's issue comment used for the bot-owned summary. GitHub also permits these comment endpoints with Pull requests write, but this setup does not otherwise require PR write access. |
| Metadata | Read | GitHub grants this mandatory repository metadata permission to GitHub Apps. |

The Check Run is the primary output. A valid config with `pr_comment: false`
skips the normal comment path. Missing or invalid config can still cause the
app to attempt an optional remediation comment; comment failures are logged
and do not replace an otherwise completed Check Run.

### Webhook Events

| GitHub event | Actions handled | Result |
| --- | --- | --- |
| `pull_request` | `opened`, `synchronize` | Evaluate the exact PR head SHA. Other pull request actions are ignored. |
| `check_run` | `requested_action` with identifier `rerun` | Mark the existing Check Run in progress and evaluate the associated PR again. Other action identifiers are ignored. |
| `push` | Pushes to `main` or `master` | If `benchmark_on_main: true`, start each `benchmark_templates` evaluation without waiting for a GitHub report. Other branches are ignored. |

The built-in server's operational paths are:

- `/health` for health responses. The current implementation matches the path
  and does not restrict the HTTP method.
- `POST /api/github/webhooks`

Use the same random value for the GitHub App webhook secret and
`GITHUB_WEBHOOK_SECRET`. The Octokit webhook middleware validates signed
deliveries before invoking the handlers.

## Runtime And Data Boundary

The package splits responsibility between GitHub, your self-hosted process,
and the AuraOne API.

The runtime is a server-side CommonJS Node.js process. `createServer()` uses
Node's built-in `http` server and Octokit's Node webhook middleware; no browser,
edge-runtime, serverless, or durable-worker adapter is included.

| Boundary | Data crossing it |
| --- | --- |
| GitHub to your process | Signed webhook payloads containing installation, repository, pull request, push, or Check Run metadata. |
| Your process to GitHub | GitHub App authentication requests, installation-token REST calls, Check Run output, and the optional PR summary. |
| Your process to AuraOne | The AuraOne API credential through the SDK; `template_id`; optional `reward_spec_id`; template `config`; an `agent_bundle_url` for the exact GitHub SHA; and an idempotency key containing the PR ID, evaluation attempt, and template ID. |
| AuraOne to your process | Evaluation ID, status, score, summary, and API errors returned by the SDK. |
| Your process back to GitHub | Escaped and length-limited decision, evidence, error, and remediation Markdown. |

The current `createAgentBundle()` implementation does not upload source bytes.
It constructs this URL shape:

```text
https://github.com/<owner>/<repository>/archive/<sha>.tar.gz
```

AuraOne must be able to fetch that URL to evaluate the source. The GitHub App
installation token is not attached to the URL or forwarded to AuraOne by this
code. Public repositories can expose the archive directly; private
repositories, restricted forks, and GitHub Enterprise Server deployments need
a different bundle-transfer implementation.

The process has no application database, durable queue, or local result store.
Durable records live in GitHub Check Runs/comments and in AuraOne evaluation
records. Secrets are read from constructor options or environment variables.
The code does not intentionally render those secrets into GitHub output, but
runtime logs and upstream error messages should still be treated as sensitive.

## Repository Config

The app reads `.auraone.yml` first and `.auraone.yaml` second from the exact
evaluated commit.

```yaml
pass_threshold: 0.8
pr_comment: true

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
      dataset: main-regression
```

| Field | Current behavior |
| --- | --- |
| `pass_threshold` | Defaults to `0.8`. Numeric values are clamped to the inclusive range `0` through `1`; non-numeric values produce an error result. |
| `pr_comment` | Defaults to enabled. Set to `false` to keep the Check Run as the normal PR review surface. |
| `templates` | PR evaluation list. At least one entry is needed for a useful evaluation. |
| `templates[].id` | Required by the app. A missing ID becomes an action-required template error. |
| `templates[].name` | Optional display name. The template ID is the fallback. |
| `templates[].reward_spec_id` | Forwarded to the AuraOne API when supplied. |
| `templates[].config` | Forwarded to the AuraOne API when supplied. |
| `benchmark_on_main` | Enables asynchronous template starts for pushes to `main` or `master`. |
| `benchmark_templates` | Templates used only by the main-branch push path. |

PR templates run sequentially with `wait: true` and a 600-second SDK timeout
per template. The overall score is the arithmetic mean of numeric template
scores. Any template error or non-completed result produces **Action
required**, even if other scores are high. If no numeric score is returned,
the calculated score is `0`.

## Remediation And Evidence

The Check Run makes the outcome inspectable without opening service logs.

### Lifecycle And Conclusions

| App state | GitHub status or conclusion | Meaning |
| --- | --- | --- |
| Queued | `queued` | A Check Run exists for the PR head commit. |
| In progress | `in_progress` | Config is being read and templates are running. |
| Passed | `success` | Every template completed and the mean score meets the threshold. |
| Failed | `failure` | Every template completed, but the mean score is below the threshold. |
| Action required | `action_required` | A template failed, did not complete, is missing an ID, or the config has no templates. |
| Skipped | `neutral` | Neither `.auraone.yml` nor `.auraone.yaml` exists at the evaluated commit. |
| Error | `failure` | Config parsing, GitHub API access, AuraOne access, or another handler step raised an exception. |

### Check Run Output

The completed Check Run includes:

- decision and GitHub conclusion;
- overall score and required threshold;
- exact evaluated commit SHA;
- selected configuration path;
- template name, score, status, and returned summary or error;
- a link to the configuration at the evaluated commit;
- a details URL when an AuraOne evaluation ID is available;
- a concrete next step;
- a **Run again** action.

Typical remediation is specific to the failure class:

- missing config: add `.auraone.yml` or `.auraone.yaml`;
- empty template list: add at least one `templates` entry;
- template/API failure: verify template IDs, reward specifications,
  credentials, and service availability, then use **Run again**;
- score below threshold: inspect template evidence, change the evaluated
  behavior, and push a commit or rerun after the evidence changes;
- permission/config error: verify GitHub App permissions, YAML syntax, and
  service credentials.

The optional PR summary carries the decision, score, threshold, commit,
configuration path, compact template table, and next step. It updates only a
comment authored by a GitHub `Bot` account that contains AuraOne's private
ownership marker; user-authored comments are not overwritten.

## Deployment And Release Proof

### Deployment Proof

This source tree contains an HTTP server, not deployment infrastructure. There
is no Dockerfile, platform manifest, public webhook hostname, GitHub App slug,
or installation URL that proves a hosted public deployment.

For a self-hosted deployment, retain these artifacts as proof:

1. A successful `GET /health` response from the production HTTPS hostname.
2. A GitHub webhook delivery record showing a successful response from
   `/api/github/webhooks`.
3. A test PR showing queued, in-progress, and completed states for one
   `AuraOne evaluation` Check Run.
4. The same PR showing one bot-owned summary updated after a synchronize
   event, rather than a second AuraOne summary.
5. A **Run again** delivery that updates the existing Check Run.

### Package And Release Proof

Do not infer npm publication from `package.json`, a changelog entry, a local
tarball, or the presence of a release workflow. Check the registry and remote
tag directly:

```bash
npm view @auraone/github-app version versions --json
git ls-remote --tags https://github.com/auraoneai/github-app.git
```

For the version currently reported by npm:

```bash
VERSION="$(npm view @auraone/github-app version)"
npm view "@auraone/github-app@$VERSION" \
  version dist.integrity dist.tarball --json
gh release view "v$VERSION" --repo auraoneai/github-app
```

Validate the current source and public tarball shape locally:

```bash
npm ci
npm run lint
npm test -- --runInBand
npm pack --dry-run
VERSION="$(node -p 'require("./package.json").version')"
node scripts/release-preflight.mjs "v$VERSION"
```

The current `.github/workflows/release-npm.yml` is configured to:

- verify an immutable, signed, version-matching tag;
- run lint, Jest, production dependency audit, and package inspection;
- build one tarball plus SHA-256 checksum and CycloneDX SBOM;
- install and import that exact tarball from a clean temporary project;
- upload immutable build evidence;
- require coordinated signed publication authorization;
- publish through npm trusted publishing with provenance only when a manual
  dispatch sets `publish: true`;
- verify the exact registry version and npm signatures;
- attest and attach matching assets to a GitHub Release.

Those controls describe intended release behavior. A successful workflow run,
matching registry metadata, and matching GitHub Release assets are the proof
that a release actually occurred.

## Limitations

- This repository does not prove that a public GitHub App is deployed. Plan to
  create and operate your own installation.
- Node.js 18 is the dependency floor. The checked-in CI configurations cover
  Node.js 20 and 22.14, not a complete supported-version matrix.
- PR webhook handlers wait for templates sequentially and there is no durable
  background queue. Long evaluations and process restarts need production
  architecture beyond the built-in server.
- The default bundle is an unauthenticated GitHub archive URL. Private
  repository source is not transferred with installation credentials.
- Pull request evaluation runs only for `opened` and `synchronize`; actions
  such as `reopened` and `ready_for_review` are not handled.
- The app creates one Check Run per PR head SHA. A new commit creates a new
  commit-scoped check; reruns update the existing check for that SHA.
- Check and comment reuse are application-level idempotency mechanisms, not
  transactional locks. Concurrent first deliveries can still race.
- Main-branch benchmarks start asynchronously and do not create a benchmark
  Check Run or PR comment.
- `AURAONE_ORG_ID` is accepted for compatibility but is not used in current
  evaluation requests.
- The app does not configure branch protection, upload custom build artifacts,
  run repository tests, or merge pull requests.
- GitHub Enterprise Server is not documented or tested; archive and evidence
  links currently assume `github.com`.
- Returned error messages are Markdown-escaped and length-limited, not
  semantically redacted. Do not include secrets in template names, config
  values intended for output, or upstream error messages.

## Next Action

Create a private GitHub App with the documented permissions, deploy this
source behind one HTTPS webhook endpoint, install it on one non-production
repository, and add a single-template `.auraone.yml`. Open a PR and verify the
Check Run lifecycle, bot-owned summary update, remediation text, evidence
link, and **Run again** behavior before enabling the app organization-wide or
requiring the check for merges.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report package security issues through
[SECURITY.md](SECURITY.md). Source changes and release targets are tracked in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
