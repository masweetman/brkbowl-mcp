# Security

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the
Security tab, not in a public issue.

## What this project must never contain

This repository is public. It must never contain phone numbers, email addresses, auth tokens,
SMS codes, HAR captures, real cart or order data, `.env` files, or the URL of a real deployment.
Use placeholders such as `(555) 010-0000`, `user@example.com` and `brkbowl.example.com`.

Safeguards:

- `.gitignore` excludes `.env*`, `data/`, `*.db`, `session*.json`, `*.har` and raw fixtures.
- A pre-commit hook (`.githooks/pre-commit`) runs `scripts/check-personal-data.mjs` and
  [gitleaks](https://github.com/gitleaks/gitleaks). It is enabled by `npm install`.
- CI scans the full git history with gitleaks and runs the personal-data check on every push.
- GitHub secret scanning and push protection are enabled.

The Homesome `apikey` and the store and price-list IDs are public values that the Berkeley Bowl
website sends to every visitor; they are not secrets.

## If you committed something sensitive

Rotate it immediately (log out of the Berkeley Bowl session, change `ADMIN_PASSWORD`,
`SESSION_ENCRYPTION_KEY`, tunnel token), then remove it from history.
