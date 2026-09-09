# P22 Production Quality And Stability

## Goal

P22 turns release checks into repeatable contracts and keeps enough lightweight client-error context to diagnose production issues. It does not add Prometheus, Grafana, Sentry, or another always-on service; it reuses the API, Redis, the system overview, and Playwright.

## Entry points

- A super administrator opens `Admin -> System overview` and runs `P22 production quality -> Run quality check`.
- Results are recorded in `Recent runs` as `Quality check`. Open `Details` to inspect each item and any OSS/R2 prerequisite block.
- The `API monitoring` section shows recent client errors with source, time, page path, and build id.

## Health endpoints

- `GET /health`: process liveness only; use it as a liveness probe.
- `GET /health/ready`: runs MySQL `SELECT 1` and Redis `PING`. It returns `200` only when both dependencies are available and `503` otherwise.
- `POST /health/client-errors`: bounded browser-error intake. It does not accept authentication tokens and must never receive passwords, cookies, request bodies, or private content.

## Browser and release checks

Run against a local production build or the deployed site:

```powershell
$env:LINGXI_E2E_URL = "http://localhost:3000"
python scripts/p22-browser-smoke.py
```

The script visits public home, English home, article, topic, and collection routes at desktop `1440px` and mobile `390px`. It checks HTTP status, console errors, page errors, failed images, and horizontal overflow. It writes screenshots to `.artifacts/p22/screenshots` and does not sign in or create data.

Run the release contract:

```powershell
$env:P22_WEB_BASE_URL = "https://your-domain.example"
pnpm p22:release-check
```

The JSON result must have `true` for every `checks[].ok`, especially `api-readiness`, both manifests, and `service-worker`.

Create a visual baseline once the public pages are stable:

```powershell
python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines --update-baseline
python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines
```

Only update a baseline after manually confirming an intentional design change.

## Status meanings and boundaries

- `Passed`: the check satisfies its contract.
- `Warning`: the code is available but a business/storage issue needs attention.
- `Blocked`: an external prerequisite such as OSS/R2 is not configured; this is not a local code failure.
- `Failed`: a dependency, migration, or integrity check cannot be read and deployment should stop.

Client errors are capped at 100 recent Redis entries with expiry. Messages, stacks, and paths are truncated, and the browser reporter does not send access tokens, refresh tokens, cookies, or form content. Browser scripts are read-only; P21 load tests remain limited to the read-only allowlist. Preserve MySQL, Redis, uploads, Caddy, TURN, and sing-box volumes during cleanup.
