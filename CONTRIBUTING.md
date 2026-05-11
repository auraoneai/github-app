# Contributing to @auraone/github-app

Thanks for your interest in contributing. This repository hosts a Probot-style GitHub App that runs AuraOne evaluations on pull requests.

## Scope

We welcome:

- Bug reports with a minimal reproduction.
- Documentation fixes — including `.auraone.yml` config schema improvements.
- Additional check states, comment formats, or merge-gating policies.
- Improvements to the self-hosting setup.

Out of scope:

- Hosted AuraOne backend behavior.

## Development

```bash
git clone https://github.com/auraoneai/github-app.git
cd github-app
npm install
cp .env.example .env  # fill in dev credentials
npm run dev
npm test
```

## Pull request expectations

- Keep changes focused.
- Add or update tests when changing behavior.

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are made under the [MIT License](LICENSE).
