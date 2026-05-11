# Security Policy

## Scope

This policy covers the `@auraone/sdk` TypeScript SDK source published in this repository.

The hosted AuraOne backend at `api.auraone.ai` is out of scope for this repository. Backend security reports should be sent to `security@auraone.ai`.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue.

- Email: `security@auraone.ai`
- Subject: `[github-app] <short description>`

Include:

- Affected SDK version.
- Description and impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- Any suggested mitigation.

We'll acknowledge within 3 business days.

## What we consider a vulnerability

- Arbitrary code execution from SDK methods processing trusted-looking input.
- Token / credential leakage paths.
- Insecure default authentication or transport behavior.

## Disclosure

We prefer coordinated disclosure. We'll work with you on a timeline that gives users time to upgrade before public details are published.
