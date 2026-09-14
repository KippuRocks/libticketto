# conformance-matrix

Runs the conformance suite once per backend package in CI (`REQ-SDK-7`,
`NFR-8`).

## Registering a backend

A backend package — `@ticketto/backend-*` or `@ticketto/binding-*` — registers
by defining a `conformance` script in its `package.json`. The script runs
`@ticketto/conformance` against that backend and exits non-zero when the suite
fails. How the backend is handed to the suite is the conformance feature's
decision; this tool only needs the script.

A backend package without the script is listed as "not yet registered" and not
run.

## In CI

`.github/workflows/ci.yml`:

1. **Conformance — discover backends** runs `conformance-matrix discover`, which
   prints the registered backends and writes them to the job's outputs.
2. **Conformance — `<backend>`** runs once per registered backend:
   `conformance-matrix run <backend>`. It is skipped when there are none.
3. **Conformance** is the aggregate check: `conformance-matrix verdict` passes
   when discovery succeeded and either zero backends are registered or every
   backend's run succeeded. Make this the required check.

```sh
pnpm build
pnpm conformance-matrix discover
pnpm conformance-matrix run @ticketto/backend-memory
```
