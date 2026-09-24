const site = {
  name: "Fernwood Ceramics",
  tagline: "Hand-thrown stoneware, made to be used every day",
  intro:
    "A two-person studio on the edge of Dartmoor. We throw, glaze and fire everything ourselves, in batches small enough that we know where each piece went.",
  cta: { label: "Ask about a commission", href: "mailto:hello@fernwood.example" },
  sections: [
    {
      title: "Tableware",
      body: "Plates, bowls and mugs in three glazes. Restocked every few weeks, and gone quickly when it is.",
    },
    {
      title: "Commissions",
      body: "Dinner sets and single pieces, thrown to the size and glaze you choose. Six to eight weeks from the first sketch.",
    },
    {
      title: "Workshops",
      body: "Saturday mornings at the wheel, four people at a time. Clay, aprons and firing included.",
    },
  ],
  contact: {
    heading: "Come and see the studio",
    body: "Open Thursday to Saturday, 10am to 4pm, at 14 Mill Lane, Ashburton. No appointment needed.",
  },
  footer: "Fernwood Ceramics, Ashburton, Devon",
};

export default {
  /** @param {Request} request */
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("This page only answers GET.", {
        status: 405,
        headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(request.method === "HEAD" ? null : page(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

function page() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(site.name)}</title>
    <meta name="description" content="${escapeHtml(site.tagline)}" />
    <style>${styles()}</style>
  </head>
  <body>
    <main>
      <header class="hero">
        <p class="eyebrow">${escapeHtml(site.name)}</p>
        <h1>${escapeHtml(site.tagline)}</h1>
        <p class="lede">${escapeHtml(site.intro)}</p>
        <a class="cta" href="${escapeHtml(site.cta.href)}">${escapeHtml(site.cta.label)}</a>
      </header>

      <section class="cards">${site.sections.map(card).join("")}
      </section>

      <section class="contact">
        <h2>${escapeHtml(site.contact.heading)}</h2>
        <p>${escapeHtml(site.contact.body)}</p>
      </section>
    </main>

    <footer>
      <p>${escapeHtml(site.footer)}</p>
      <p class="attribution"><a href="https://wawesome.io">Built with wawesome</a></p>
    </footer>
  </body>
</html>
`;
}

/** @param {(typeof site)["sections"][number]} section */
function card(section) {
  return `
        <article>
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.body)}</p>
        </article>`;
}

/** @type {Record<string, string>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {string} value */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function styles() {
  return `
      :root {
        color-scheme: light dark;
        --ink: #171512;
        --muted: #6b645c;
        --page: #faf7f2;
        --card: #fffdfa;
        --line: #e7e0d6;
        --accent: #8a4b2a;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --ink: #f3efe9;
          --muted: #a9a199;
          --page: #16140f;
          --card: #1e1b16;
          --line: #2e2a23;
          --accent: #e29a6b;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: clamp(1.5rem, 5vw, 5rem) 1.5rem;
        background: var(--page);
        color: var(--ink);
        font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      main, footer { max-width: 62rem; margin: 0 auto; }
      .eyebrow {
        margin: 0 0 1.25rem;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--accent);
      }
      h1 {
        margin: 0;
        font-size: clamp(2.25rem, 6vw, 3.75rem);
        line-height: 1.1;
        letter-spacing: -0.02em;
        max-width: 18ch;
      }
      .lede {
        margin: 1.25rem 0 2rem;
        font-size: clamp(1.05rem, 2.2vw, 1.25rem);
        color: var(--muted);
        max-width: 54ch;
      }
      .cta {
        display: inline-block;
        padding: 0.85rem 1.6rem;
        border-radius: 999px;
        background: var(--accent);
        color: var(--page);
        font-weight: 600;
        text-decoration: none;
      }
      .cta:hover { filter: brightness(1.08); }
      .cards {
        display: grid;
        gap: 1.25rem;
        grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        margin: clamp(3rem, 8vw, 5rem) 0;
      }
      .cards article {
        padding: 1.75rem;
        border: 1px solid var(--line);
        border-radius: 1rem;
        background: var(--card);
      }
      .cards h2 { margin: 0 0 0.6rem; font-size: 1.15rem; }
      .cards p { margin: 0; color: var(--muted); }
      .contact {
        padding-top: clamp(2rem, 6vw, 3rem);
        border-top: 1px solid var(--line);
      }
      .contact h2 { margin: 0 0 0.6rem; font-size: 1.5rem; }
      .contact p { margin: 0; color: var(--muted); max-width: 48ch; }
      footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.5rem;
        justify-content: space-between;
        margin-top: clamp(3rem, 8vw, 5rem);
        padding-top: 1.5rem;
        border-top: 1px solid var(--line);
        font-size: 0.9rem;
        color: var(--muted);
      }
      footer p { margin: 0; }
      footer a { color: inherit; }
    `;
}
