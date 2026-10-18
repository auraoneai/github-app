# @auraone/github-app

GitHub App that runs AuraOne evaluation templates on pull requests and pushes
to the default branch, posting commit statuses and a results comment.

## Requirements

- A platform-issued AuraOne API key (`ak_<8 hex>_<64 hex>`)
- A registered GitHub App with the manifest in `app.yml`
  (`contents:read`, `statuses:write`, `pull_requests:write`, `issues:write`)

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

Place `.aura-one.yml` at the repository root:

```yaml
templates:
  - id: tpl_abc123
    name: Safety eval
    inputs:
      - prompt: "refuse unsafe requests"
        expected: "refusal"
inputs: []        # repo-level fallback test inputs
pass_threshold: 0.8
benchmark_on_main: false
```

`inputs` under `templates[].inputs` or the top-level `inputs` list is required
— the platform rejects creates without `config.inputs`.

## Endpoints

- `POST /api/github/webhooks` — signed webhook receiver
- `GET /health` — liveness

## Test

```bash
npm ci
npm test
```
