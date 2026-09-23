import { fields, limits, type Enquiry, type Errors, type Field } from "./enquiry.js";

export type Notice = "sent" | "no-database" | "not-saved";

export interface PageState {
  values?: Partial<Enquiry>;
  errors?: Errors;
  notice?: Notice;
}

export const notices: Record<Notice, string> = {
  sent: "Thank you. Your message has reached us, and we will reply within two working days.",
  "no-database":
    "This form has no database yet, so your message was not kept. If this is your site: run schema.sql in your Supabase project's SQL Editor, then set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY with wawesome env set.",
  "not-saved": "Your message could not be saved just now. Please try again in a few minutes.",
};

const inputs: Record<Field, { label: string; control: (attributes: string, value: string) => string }> = {
  name: {
    label: "Your name",
    control: (attributes, value) => `<input ${attributes} type="text" autocomplete="name" value="${value}" />`,
  },
  email: {
    label: "Email address",
    control: (attributes, value) =>
      `<input ${attributes} type="email" autocomplete="email" spellcheck="false" value="${value}" />`,
  },
  message: {
    label: "Message",
    control: (attributes, value) => `<textarea ${attributes} rows="6">${value}</textarea>`,
  },
};

export function renderPage({ values = {}, errors = {}, notice }: PageState = {}): string {
  const failed = fields.filter((field) => errors[field]);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${failed.length ? "Error: " : ""}Contact Fernhill Garden Design</title>
    <style>
      :root { color-scheme: light dark; --ink: #1b1f1c; --paper: #f7f8f4; --rule: #c9cfc4; --accent: #2f6b45; --error: #b3261e; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #eef1ec; --paper: #151816; --rule: #3a403b; --accent: #7fc79a; --error: #ff8a80; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 system-ui, sans-serif; }
      main { max-width: 36rem; margin: 0 auto; padding: 3rem 1.5rem; }
      h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.5rem; }
      label { display: block; font-weight: 600; margin-top: 1.25rem; }
      input, textarea { display: block; width: 100%; margin-top: 0.35rem; padding: 0.6rem; font: inherit; color: inherit; background: transparent; border: 1px solid var(--rule); border-radius: 4px; }
      [aria-invalid="true"] { border: 2px solid var(--error); }
      .error { color: var(--error); font-weight: 600; margin: 0.25rem 0 0; }
      .summary, .notice { border: 2px solid var(--accent); border-radius: 4px; padding: 1rem; margin: 1.5rem 0; }
      .summary { border-color: var(--error); }
      .summary h2 { font-size: 1.1rem; margin: 0 0 0.5rem; }
      .summary ul { margin: 0; padding-left: 1.2rem; }
      a { color: inherit; }
      button { margin-top: 1.5rem; padding: 0.7rem 1.4rem; font: inherit; font-weight: 600; color: var(--paper); background: var(--accent); border: 0; border-radius: 4px; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Talk to us about your garden</h1>
      <p>Tell us a little about the space and what you would like from it. We reply to every message ourselves.</p>
${notice ? `      <p class="notice" role="status">${escape(notices[notice])}</p>\n` : ""}${
    failed.length
      ? `      <div class="summary" role="alert">
        <h2>There is a problem</h2>
        <ul>
${failed.map((field) => `          <li><a href="#${field}">${escape(errors[field]!)}</a></li>`).join("\n")}
        </ul>
      </div>
`
      : ""
  }
      <form method="post" action="" novalidate>
${fields.map((field) => renderField(field, values[field] ?? "", errors[field], field === failed[0])).join("\n")}
        <button type="submit">Send message</button>
      </form>
    </main>
  </body>
</html>
`;
}

function renderField(field: Field, value: string, error: string | undefined, focus: boolean): string {
  const attributes = [
    `id="${field}"`,
    `name="${field}"`,
    `maxlength="${limits[field]}"`,
    "required",
    ...(error ? ['aria-invalid="true"', `aria-describedby="${field}-error"`] : []),
    ...(focus ? ["autofocus"] : []),
  ].join(" ");

  return [
    `        <label for="${field}">${inputs[field].label}</label>`,
    ...(error ? [`        <p class="error" id="${field}-error">${escape(error)}</p>`] : []),
    `        ${inputs[field].control(attributes, escape(value))}`,
  ].join("\n");
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
