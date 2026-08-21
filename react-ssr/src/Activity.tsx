import { use } from "react";

export interface Event {
  at: string;
  what: string;
}

/**
 * Stands in for the query this page will actually make — a database read, a
 * lookup against an upstream API, anything slow enough to be worth not blocking
 * on.
 *
 * Whatever replaces it, keep the shape. It is started by the entry point, so
 * it is already in flight when rendering begins, and it is awaited inside a
 * `<Suspense>` boundary, so the header and everything around it go out on the
 * wire while this is still resolving. React sends this section's markup
 * afterwards, with the few bytes of script that slot it into place.
 */
export async function loadActivity(): Promise<Event[]> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return [
    { at: "09:14", what: "Version 7 promoted" },
    { at: "09:02", what: "3 assets uploaded, 41 already held" },
    { at: "08:57", what: "Version 6 built" },
  ];
}

export function Activity({ events }: { events: Promise<Event[]> }) {
  return (
    <section className="panel">
      <h2>Recent activity</h2>
      <ul className="events">
        {use(events).map((event) => (
          <li key={event.at}>
            <span className="when">{event.at}</span>
            {event.what}
          </li>
        ))}
      </ul>
      <p className="muted">This arrived after the header did. Nothing above it waited on it.</p>
    </section>
  );
}
