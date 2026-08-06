/**
 * Everything that decides whether a request is worth paying for, before a
 * single token is bought.
 *
 * This endpoint is public — the whole point is that a browser can call it — so
 * every field in it is attacker-controlled. Two separate things are being
 * defended: the system prompt, which the client must never be able to replace,
 * and the bill, which the client must never be able to raise. Both are decided
 * here, with no network involved, so they are cheap to enforce and cheap to
 * test.
 */

/**
 * The ceilings on one request. These are the cost control: with them, the most
 * expensive request anyone can send is bounded and calculable, whatever they
 * put in the body. Edit them — they are yours, and the right numbers depend on
 * what your assistant is for.
 */
export const LIMITS = {
  /** How much conversation history a client may replay at you. */
  maxMessages: 12,
  /**
   * The raw body, checked before parsing. The envelope, not the prompt: it is
   * here so a hostile caller cannot make the function parse megabytes of JSON
   * only to be told the prompt was too long.
   */
  maxBodyChars: 24_000,
  /** The text that actually reaches the model, and so actually costs money. */
  maxPromptChars: 8_000,
  /** The hard ceiling on the answer. Never taken from the request. */
  maxOutputTokens: 512,
} as const;

/** A message the client is allowed to send. Note which role is missing. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A request answered here rather than upstream. The `error` is written for the
 * developer wiring up the frontend, and never quotes what the client sent — a
 * refusal that echoes its input is a way to make this endpoint reflect an
 * attacker's text back into someone else's page.
 */
export interface Refusal {
  status: number;
  error: string;
}

export type OriginCheck = { ok: true; allowOrigin: string } | { ok: false; refusal: Refusal };
export type ChatRequest = { ok: true; messages: ChatMessage[] } | { ok: false; refusal: Refusal };

const deny = (status: number, error: string): { ok: false; refusal: Refusal } => ({
  ok: false,
  refusal: { status, error },
});

/**
 * The comparable form of an origin: an origin typed into configuration by a
 * human tends to carry a trailing slash and mixed case, and a browser sends
 * neither. Both sides of the comparison go through here, so the configured
 * list and the incoming header cannot drift into disagreeing about what
 * counts as the same origin.
 */
function normaliseOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

/** Read `ALLOWED_ORIGINS` into the list to compare against. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(normaliseOrigin)
    .filter((origin) => origin.length > 0);
}

/**
 * Decide whether this origin may call the endpoint, and what to answer CORS with.
 *
 * An empty list means no gate: a template that refused every request until it
 * was configured would look broken on its first deploy. Once a list exists it is
 * the whole gate, so a request with no `Origin` header is refused too — waving
 * those through would switch the gate off for every non-browser caller, which is
 * every caller worth gating against.
 *
 * Worth being clear about what this is: `Origin` is set by the browser and
 * trusted by the browser, so this stops another website from spending your
 * budget from a visitor's tab. It is not a defence against someone running
 * curl. See the README.
 */
export function checkOrigin(origin: string | null, allowed: string[]): OriginCheck {
  if (allowed.length === 0) return { ok: true, allowOrigin: "*" };

  if (origin && allowed.includes(normaliseOrigin(origin))) {
    // Echoed exactly as received: CORS compares byte for byte, so answering
    // with a normalised form is answering with an origin that will not match.
    return { ok: true, allowOrigin: origin };
  }

  return deny(403, "This origin is not allowed to call this endpoint.");
}

/** The only top-level field a client may send. Everything else is the server's. */
const ALLOWED_FIELDS = new Set(["messages"]);

/**
 * Turn an untrusted request body into the conversation that will be paid for,
 * or into the reason it will not be.
 *
 * Takes the raw text rather than a parsed object so the envelope cap applies
 * before `JSON.parse` runs.
 */
export function parseChatRequest(raw: string): ChatRequest {
  if (raw.length > LIMITS.maxBodyChars) {
    return deny(413, `Request body is too large (limit ${LIMITS.maxBodyChars} characters).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return deny(400, "Request body must be JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return deny(400, "Request body must be a JSON object.");
  }

  const extra = Object.keys(parsed).filter((key) => !ALLOWED_FIELDS.has(key));
  if (extra.length > 0) {
    return deny(400, "Only 'messages' is accepted — the model and generation settings are fixed on the server.");
  }

  const { messages } = parsed as { messages?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    return deny(400, "'messages' must be a non-empty array.");
  }

  if (messages.length > LIMITS.maxMessages) {
    return deny(413, `Too many messages (limit ${LIMITS.maxMessages}). Summarise the conversation before sending it.`);
  }

  const checked: ChatMessage[] = [];
  let promptChars = 0;

  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      return deny(400, "Each message must be an object with a 'role' and a 'content'.");
    }

    const { role, content } = message as { role?: unknown; content?: unknown };
    if (typeof content !== "string" || content.trim().length === 0) {
      return deny(400, "Each message needs a non-empty string 'content'.");
    }

    // Checked ahead of the general role rule so the client learns the actual
    // reason: the system prompt is not a field of this API.
    if (role === "system" || role === "developer") {
      return deny(403, "The system prompt is set on the server and cannot be supplied by the client.");
    }
    if (role !== "user" && role !== "assistant") {
      return deny(400, "Message roles must be 'user' or 'assistant'.");
    }

    promptChars += content.length;
    checked.push({ role, content });
  }

  if (promptChars > LIMITS.maxPromptChars) {
    return deny(413, `Conversation is too long (limit ${LIMITS.maxPromptChars} characters of text).`);
  }

  if (checked[checked.length - 1]!.role !== "user") {
    return deny(400, "The last message must be from the user — there is nothing to answer otherwise.");
  }

  return { ok: true, messages: checked };
}
