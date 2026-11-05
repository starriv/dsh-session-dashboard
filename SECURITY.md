# Security

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub Security
Advisories on this repository, or by email to the maintainer listed in
`package.json`. Do not open a public issue containing session contents, tokens,
titles, working directories or exploit details.

## Data exposure model

`/dsh-session-stats/snapshot` returns local session titles, working directories,
token usage and estimated spend. The route is **fail-closed**:

- when the DSH `connection` service is present, it reuses the service's
  browser/API admission (`connection.requestRejection`) and signed-cookie
  checks; `ping` uses the same gate;
- when no `connection` service is composed, both routes return
  `503 auth-unavailable` unless a composition explicitly sets
  `allowUnauthenticated: true`.

The explicit `allowUnauthenticated` switch is intended only for an isolated
loopback-only deployment where another authentication layer is known to exist.
It must not be used on a network-reachable Host.

## Hardening already present

- Read-only routes; `GET`/`HEAD` only.
- No request-controlled filesystem paths; symlinks are not followed during
  discovery.
- Session files are bounded by `maxFileBytes` and decoded output by
  `maxDecodedBytes`; oversized files are skipped and reported.
- Internal errors are logged on the Host and returned as generic JSON.
- Response headers include `cache-control: no-store` and
  `x-content-type-options: nosniff`.
