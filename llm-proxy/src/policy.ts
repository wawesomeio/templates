import * as z from "zod";

export const LIMITS = {
  maxBodyBytes: 24_000,
  maxMessages: 12,
  maxPromptChars: 8_000,
  maxOutputTokens: 512,
} as const;

const SERVER_ONLY_ROLES = ["system", "developer"];

const Message = z.object({
  role: z
    .string("Message roles must be 'user' or 'assistant'.")
    .refine((role) => !SERVER_ONLY_ROLES.includes(role), {
      error: "The system prompt is set on the server and cannot be supplied by the client.",
      params: { status: 403 },
    })
    .pipe(z.enum(["user", "assistant"], "Message roles must be 'user' or 'assistant'.")),
  content: z
    .string("Each message needs a non-empty string 'content'.")
    .trim()
    .min(1, "Each message needs a non-empty string 'content'."),
});

export const ChatRequest = z.strictObject(
  {
    messages: z
      .array(Message, "'messages' must be a non-empty array.")
      .min(1, "'messages' must be a non-empty array.")
      .max(LIMITS.maxMessages, `Too many messages (limit ${LIMITS.maxMessages}). Summarise the conversation first.`)
      .refine((messages) => messages.reduce((chars, m) => chars + m.content.length, 0) <= LIMITS.maxPromptChars, {
        error: `Conversation is too long (limit ${LIMITS.maxPromptChars} characters of text).`,
        params: { status: 413 },
      })
      .refine((messages) => messages.at(-1)?.role === "user", "The last message must be from the user."),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Only 'messages' is accepted. The model and generation settings are fixed on the server."
        : "Request body must be a JSON object.",
  },
);

export function refusalStatus(issue: z.core.$ZodIssue): 400 | 403 | 413 {
  if (issue.code === "too_big") return 413;
  if (issue.code === "custom" && issue.params?.status) return issue.params.status;
  return 400;
}

// Configured origins tend to carry a trailing slash or capitals, and a browser sends neither.
function normalise(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

/** The `Access-Control-Allow-Origin` to answer with, or `null` for an origin that is refused. */
export function allowedOrigin(origin: string | undefined, configured: string | undefined): string | null {
  const allowed = (configured ?? "").split(",").map(normalise).filter(Boolean);
  if (allowed.length === 0) return "*";
  // Echoed as received: the browser compares it byte for byte.
  return origin && allowed.includes(normalise(origin)) ? origin : null;
}
