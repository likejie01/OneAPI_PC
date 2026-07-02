# Open Source Security Checklist

This client must be safe to publish without trusting the client as a security boundary.

## Client Source Rules

- Do not commit `server.env`, `.env*`, release artifacts, caches, local CLI state, API keys, access tokens, private IPs, SSH hosts, MinIO credentials, database credentials, or admin tokens.
- Do not commit local payment material such as `alipay/`, certificate files, private keys, CSR files, or merchant environment files.
- Do not commit local screenshot captures such as `images/Snipaste_*.png`, `images/PixPin_*.png`, or `images/codex-clipboard-*.png` unless they have been reviewed and intentionally added.
- The public OneAPI service URL may appear in source for official builds. Private infrastructure addresses and credentials must not.
- Open-source forks can override official endpoints at build/runtime with `VITE_ONEAPI_SERVER_BASE_URL`, `VITE_ONEAPI_CODEX_BASE_URL`, `VITE_ONEAPI_CLAUDE_BASE_URL`, `ONEAPI_SERVER_BASE_URL`, `ONEAPI_CODEX_BASE_URL`, and `ONEAPI_CLAUDE_BASE_URL`.
- User-provided custom API keys stay in local client storage and are only sent to the configured custom OpenAI-compatible provider.
- OneAPI access tokens must only be sent to the OneAPI server through the normal desktop request path.
- Custom provider requests must not include OneAPI auth headers, user IDs, subscription state, wallet state, or mobile bridge identifiers.

## Accepted client-local storage

- Login credentials, user API keys, selected desktop API keys, and custom provider keys are client-local user data by design in this desktop client.
- Codex/Claude CLI keys may be written into Codex/Claude config files and process/user environment variables so the external CLI tools can run.
- These accepted local storage paths are not a server-side trust boundary. Server APIs must still authenticate and authorize every sensitive operation.

## Server-Side Requirements

- Database safety cannot rely on closed client source. All database writes must be protected by server-side authentication, authorization, input validation, rate limits, audit logs, and least-privilege database credentials.
- Subscription, wallet, service management, API key creation, mobile bridge, update publishing, and MinIO publishing must remain server-side controlled.
- Mobile bridge is OneAPI-only because cross-device sync requires the OneAPI relay server.

## Release Checklist

- Run a source scan before publishing:
  `rg -n "password|secret|DATABASE|POSTGRES|MINIO|SSH|PRIVATE|192\\.168|root@|server\\.env|sk-[A-Za-z0-9]" . -g "!release/**" -g "!dist/**" -g "!dist-electron/**" -g "!node_modules/**" -g "!.cache/**" -g "!package-lock.json"`
- Confirm build artifacts are generated locally and not committed.
- Confirm any deployment credentials are only available in CI or local operator environment, never in the client repository.
