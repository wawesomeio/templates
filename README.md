# wawesome templates

Starter projects for [wawesome.io](https://wawesome.io) — small serverless
backends that run on WebAssembly.

Every template here is a **real project**, not a scaffold. No placeholder tokens,
no substitution pass, no tooling required to make it work: clone it, `npm install`,
`npx wawesome deploy`. What you read in this repository is exactly what runs.

## Templates

| Template | What it is |
| --- | --- |
| [`stripe-webhook`](stripe-webhook) | A Stripe webhook endpoint with signature verification already wired and tested |

## Using a template

Clone it and deploy — no scaffolding tooling involved:

```bash
git clone https://github.com/wawesomeio/templates
cd templates/stripe-webhook
npm install
npx wawesome login
npx wawesome deploy
```

A one-command path — `wawesome init --template stripe-webhook`, which fetches the
template, asks only what it genuinely needs, and deploys — is being built. It will
end in exactly the same place as the clone above, because there is nothing to
substitute: it patches two fields, the package name and the App and Function names
in `wawesome-function.json`, and copies every other file byte for byte.

## How a template is put together

```
stripe-webhook/
├── template.json            what the template needs before it can run
├── wawesome-function.json   which App and Function it deploys to
├── package.json             its own real dependencies
├── README.md                what a visitor reads before signing up for anything
└── src/                     the project
```

`template.json` is a **requirements declaration**, validated against
[`template.schema.json`](template.schema.json). It names the template, the
environment variables to prompt for — each with a pointer to where in the
provider's dashboard that value is found — any outbound providers the template
calls, and the message printed after a successful deploy. It declares; the CLI
satisfies each requirement through an endpoint the platform already ships.

Provider SDKs are imported **type-only**:

```ts
import type Stripe from "stripe";
```

You get the full type definitions and editor autocomplete, and the bundler erases
the import at build time — zero bundle weight. This also sidesteps a real
constraint: SDKs written against Node built-ins do not survive the WebAssembly
runtime, so the parts that matter are implemented against web APIs the runtime
actually provides.

## Versioning: stable tags, not the default branch

Each template has a **stable ref** — a flat tag named after the template, e.g.
`stripe-webhook`. That is what the CLI fetches, and what the catalogue points at.

CI advances a template's tag only after that exact commit has been deployed to
the real platform with the **published** CLI and driven end to end. So:

- One bad commit on `main` cannot break scaffolding for new users.
- Rolling a template back is moving one ref — instant, no gateway deploy, no CLI
  release.
- Fixing a typo in a template needs neither of those either.

The refs are flat rather than slashed on purpose: git cannot hold both a ref
named for a template and refs nested beneath that same name, and a slash is
rewritten as a hyphen inside the fetched archive's root directory.

## Adding a template

Add a directory containing a `template.json`. CI discovers it automatically —
there is no list to update here, and no CLI release involved.

A template must:

- be a complete, installable, type-checking project with no placeholder tokens;
- ship its own `package.json` (with a real dependency on the published CLI) and
  its own `wawesome-function.json`;
- carry a `README.md` a stranger can read end to end before signing up;
- declare its requirements in `template.json`, with a `{{url}}` in its
  post-deploy message;
- have a smoke test at `.github/smoke/<template>.mjs` that drives the deployed
  Function the way its real caller would.

CI discovers the directory on its own, but nothing points users at it until the
template is added to the platform's discovery catalogue, which backs both the
gallery and `wawesome templates`.

Check your work before pushing:

```bash
npm install && npm run validate      # manifests
cd <template> && npm ci && npm run typecheck && npm test
```

## Repository CI

`.github/workflows/templates.yml` runs in two halves.

**Always:** validate every manifest, then type-check, test and build every
template, asserting the built bundle stays small enough to prove no provider SDK
leaked into it.

**Once a gateway exists:** deploy each template to the real platform with the
published CLI, drive it end to end, and only then advance its stable tag.

That second half is **dormant today** — there is no deployed gateway to test
against yet. It switches on when the `WAWESOME_GATEWAY_URL` repository variable
is set, alongside these in the `smoke` environment:

| Name | Kind | What it is |
| --- | --- | --- |
| `WAWESOME_GATEWAY_URL` | variable | The gateway to deploy against — setting this enables the smoke deploy |
| `WAWESOME_TENANT_JWT` | secret | Token for the CI workspace |
| `WAWESOME_TENANT_ID` | secret | That workspace's id |

Skipping is safe because the tag advance lives *inside* the smoke-deploy job: no
smoke deploy means no tag moves, so a template can never be published on the
strength of a type-check alone. It also means **no stable tag exists yet**, which
is fine — nothing can fetch a template before there is a gateway to deploy it to
either.

Two things to settle before that half goes live:

- **Authentication.** Tenant JWTs last 30 minutes, so a token pasted into a
  repository secret is expired long before CI reads it. This needs a token minted
  during the run, or a long-lived deploy token on the platform.
- **Where it deploys.** A workspace whose Apps are safe for CI to overwrite.

## License

MIT — see [LICENSE](LICENSE). Take these, change them, ship them.
