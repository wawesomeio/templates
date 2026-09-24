# Scheduled Job

A job that runs on a timer. It is private, it checks who started it, and it logs what it found.

As shipped, it checks one address every five minutes and logs whether it answered. Replace that check with your own work.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

Then tell it what to check. Until you do, every run fails and logs that it has nothing to check:

```bash
npx wawesome env set TARGET_URL https://httpbin.org/status/200
```

Use your own service's health endpoint instead of `httpbin.org`. `npx wawesome init --template scheduled-job` asks for the same value.

```bash
npx wawesome cron list       # the schedules, and when each fires next
npx wawesome logs --follow   # follow the runs as they happen
npx wawesome invoke          # run it now, without waiting for the timer
```

## The files

- [`wawesome-function.json`](wawesome-function.json) declares the Function, its schedule, and that it is private.
- [`src/index.ts`](src/index.ts) is the handler. It checks the trigger, runs the check, logs the result and returns `204`.
- [`src/check.ts`](src/check.ts) is the job itself. Replace its body with the work you want done.

## How it works

### Private visibility

```json
{
  "app": "scheduled-job",
  "function": "health-check",
  "entry": "src/index.ts",
  "visibility": "private",
  "opens_host": ["TARGET_URL"],
  "schedules": [
    {
      "name": "health-check",
      "expression": "*/5 * * * *"
    }
  ]
}
```

`"visibility": "private"` means the Function has no public address. Nobody on the internet can reach it. It runs when its schedule fires, when you run `wawesome invoke`, or on your machine while you develop.

### Schedules

A schedule is a 5-field cron expression, in UTC. The shortest interval is five minutes. Deploying the file is all it takes to start the timer.

A scheduled run is different from a request:

- Nobody waits for the response, so the platform throws the body away.
- The status code is the result. A 2xx records a successful run. Anything else records a failed run.
- The run gets the platform's full time limit, not the shorter one a waiting caller gets.

So logs are the only output a run has. The handler returns `204` even when the check fails, because the job itself ran. The failure is in the log line. Return a non-2xx instead if you want a failed check to count as a failed run.

### Who started the run

The platform sets the `x-wawesome-trigger` header on every run:

- `schedule`: the timer fired.
- `manual`: someone ran `wawesome invoke`, or called the management API.
- `caller`: an HTTP request. The handler treats a missing header the same way.

A caller cannot fake this header. Every `x-wawesome-*` header is removed from a request before your code sees it. So the handler lets `schedule` and `manual` runs through without its own check:

```ts
export function isAuthorizedTrigger(request: Request): boolean {
  const trigger = request.headers.get("x-wawesome-trigger");
  if (trigger === "schedule" || trigger === "manual") {
    return true;
  }

  const jobSecret = process.env.JOB_SECRET;
  if (!jobSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${jobSecret}`;
}
```

Any other request must send `Authorization: Bearer <JOB_SECRET>` once you set `JOB_SECRET`. That only matters if you make the Function public later.

### The host it calls

A Function can call only the hosts its App allows. `TARGET_URL` is listed under `opens_host`. When you set it, during `init` or with `wawesome env set`, the CLI adds the host in that address to your App's allowlist. Only that host is opened, and only over HTTPS on the default port. There is no fallback address.

The allowlist follows the value you set, not the code. If you change the code to call another host, calls to it are refused. Open it under **Egress** in the [dashboard](https://dashboard.wawesome.io). [The egress docs](https://wawesome.io/docs/egress) show how.

## Managing schedules

```bash
npx wawesome cron list
npx wawesome cron pause health-check    # cancels pending runs, leaves the code alone
npx wawesome cron resume health-check
```

## Configuration

```bash
# Check another address. Its host is opened too.
npx wawesome env set TARGET_URL https://api.mycompany.com/health

# Make HTTP callers send a secret
npx wawesome env set JOB_SECRET $(openssl rand -hex 24) --secret
```

## Tests

```bash
npm test
npm run typecheck
```

The tests call the handler the way the platform does: a `Request` in, a `Response` out. They replace `fetch`, so no run reaches the network. Keep them as a pattern for your own, or delete them.
