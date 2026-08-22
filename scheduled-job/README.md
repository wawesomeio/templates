# Scheduled Job

A recurring background job that runs on a timer — private visibility, a Schedule block, trigger verification, and structured logging.

Deploy it and you have an endpoint health probe running automatically every five minutes on WebAssembly, with no servers or cron daemons to maintain.

## What it does

1. **Runs on a schedule:** Fired automatically by the platform's scheduler according to the cron expression defined in [`wawesome-function.json`](wawesome-function.json).
2. **Private by default:** Has no public HTTP mount on the web. It cannot be reached or triggered by anonymous strangers on the open internet.
3. **Trigger-header verification:** Distinguishes between scheduled runs, manual runs, and HTTP callers using `x-wawesome-trigger`.
4. **Structured logging:** Outputs check status and latency to stdout/stderr, which you can stream with `wawesome logs --follow`.
5. **Clean completion:** Returns an empty `204 No Content` to signal success.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

Once deployed, your scheduled job is active.

```bash
# View active schedules and when the job next fires
npx wawesome cron list

# Follow execution logs in real time
npx wawesome logs --follow

# Trigger a run immediately without waiting for the next tick
npx wawesome invoke
```

## How it works

### 1. Private visibility

In [`wawesome-function.json`](wawesome-function.json):

```json
{
  "app": "scheduled-job",
  "function": "health-check",
  "entry": "src/index.ts",
  "visibility": "private",
  "schedules": [
    {
      "name": "health-check",
      "expression": "*/5 * * * *"
    }
  ]
}
```

Declaring `"visibility": "private"` withholds the public URL mount entirely. The Function is not registered on your App's public hostname, ensuring it can only be fired by its configured Schedules, by authenticated developers via `wawesome invoke`, or locally during development.

### 2. Schedules and execution bounds

The `schedules` block declares recurring timers using 5-field UTC cron expressions (minimum 5-minute interval).

When a Schedule fires:
- The job runs as a **Background run** dispatched by the platform.
- It receives the platform's full **invocation ceiling** (execution budget) rather than caller-facing timeout bounds.
- The response body is **discarded** because nobody is waiting on the other end of an HTTP connection.
- A **2xx status code** (like `204 No Content`) records a successful run in the invocation history. A non-2xx status code records a failed run (guest fault).

### 3. Trigger verification

When the platform dispatches a background run, it sets the `x-wawesome-trigger` header:
- `schedule`: Fired by a timer tick.
- `manual`: Fired through `wawesome invoke` or the authenticated management API.
- `caller`: Fired by an inbound HTTP request.

`x-wawesome-*` is a reserved platform namespace stripped from inbound public requests before your code runs, so external callers cannot spoof this header. In [`src/index.ts`](src/index.ts):

```ts
export function isAuthorizedTrigger(request: Request): boolean {
  const trigger = request.headers.get("x-wawesome-trigger");

  // Scheduled timer runs and manual triggers are authenticated by the platform
  if (trigger === "schedule" || trigger === "manual") {
    return true;
  }

  // HTTP callers must supply a valid bearer token if JOB_SECRET is set
  const jobSecret = process.env.JOB_SECRET;
  if (!jobSecret) return true;

  return request.headers.get("authorization") === `Bearer ${jobSecret}`;
}
```

This lets the Function keep its own authorization checks for direct HTTP requests while allowing scheduled runs to execute cleanly.

### 4. Logging as the output channel

Because background runs do not face a caller, structured logs (`console.log` / `console.error`) are the primary output channel. Watch runs in real time:

```bash
npx wawesome logs --follow
```

## Managing schedules

```bash
# List all schedules for the function
npx wawesome cron list

# Pause a schedule (cancels pending ticks without affecting code)
npx wawesome cron pause health-check

# Resume a paused schedule
npx wawesome cron resume health-check
```

## Configuration

Set optional environment variables:

```bash
# Change the target URL to monitor
npx wawesome env set TARGET_URL https://api.mycompany.com/health

# Protect direct manual HTTP requests with a secret
npx wawesome env set JOB_SECRET $(openssl rand -hex 24) --secret
```
