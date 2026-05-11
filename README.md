# @auraone/github-app

GitHub App for automated AuraOne evaluations on pull requests.

Drops AuraOne eval runs into the PR check experience: open a PR, the app picks up the configuration in `.auraone.yml`, runs the configured eval against the bundle or model under change, and posts results as a Check Run with a structured summary comment.

This is the **source** distribution for self-hosting or contribution. A hosted instance of the same app is available via the AuraOne dashboard once you have an account.

## What it does

- Listens for `pull_request` events on installed repositories.
- Reads `.auraone.yml` (or `.auraone.yaml`) from the PR head.
- Calls the AuraOne hosted API via [`@auraone/sdk`](https://www.npmjs.com/package/@auraone/sdk) to start an evaluation run.
- Reports a `auraone/evaluation` Check Run with status, score, and a link to the full evidence record.
- Optionally blocks merge until the eval passes a configured threshold.

## Configuration

Drop a `.auraone.yml` in your repo root:

```yaml
template_id: rubric.web.qa
agent_bundle_url: s3://my-bucket/bundle.zip
threshold: 0.85
fail_on_threshold: true
```

## Self-hosting

```bash
git clone https://github.com/auraoneai/github-app.git
cd github-app
npm install
cp .env.example .env  # fill in GitHub App credentials + AURAONE_API_KEY
npm start
```

### Required env vars

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` (PEM)
- `GITHUB_WEBHOOK_SECRET`
- `AURAONE_API_KEY`
- `AURAONE_BASE_URL` (optional, defaults to `https://api.auraone.ai`)

## Hosted version

If you'd rather not self-host, install the hosted version from the AuraOne dashboard at https://www.auraone.ai/developers/integrations.

## Development

```bash
npm install
npm run dev    # nodemon
npm test       # jest
npm run lint
```

## Related

- [`@auraone/sdk`](https://www.npmjs.com/package/@auraone/sdk) — TypeScript SDK this app uses internally.
- [`auraone-sdk`](https://pypi.org/project/auraone-sdk/) — Python SDK with the same API surface.
- [`auraone-evalkit`](https://pypi.org/project/auraone-evalkit/) — local, no-account evaluation tooling.

## License

MIT — see [LICENSE](LICENSE).
