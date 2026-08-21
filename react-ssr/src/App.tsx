import { Suspense, useState } from "react";
import { Activity, type Event } from "./Activity.js";
import { assetUrl } from "./mount.js";
import "./app.css";

export interface PageProps {
  /** The mount this request arrived under, and the root of every URL below. */
  base: string;
  /** The address the caller typed, reassembled from what the Function was handed. */
  address: string;
  /** Started by the entry point, so it is in flight before rendering begins. */
  activity: Promise<Event[]>;
}

export function App({ base, address, activity }: PageProps) {
  return (
    <div className="page">
      <header className="masthead">
        <img className="mark" src={assetUrl(base, "wawesome.svg")} alt="" width={36} height={36} />
        <div>
          <h1>Rendered on the server</h1>
          <p className="lede">
            This markup was produced by WebAssembly and streamed to you. The browser had
            something to read before it had any JavaScript to run.
          </p>
        </div>
      </header>

      <Suspense fallback={<ActivityPending />}>
        <Activity events={activity} />
      </Suspense>

      <WhatTheFunctionSaw base={base} address={address} />

      <footer className="footer">
        <code>src/App.tsx</code> is this page. <code>src/entry.server.tsx</code> is the
        handler the platform calls. Everything else follows from those two.
      </footer>
    </div>
  );
}

/**
 * State that only exists once React has taken the markup over — so if this
 * button does anything, hydration matched.
 */
function WhatTheFunctionSaw({ base, address }: Omit<PageProps, "activity">) {
  const [shown, setShown] = useState(false);

  return (
    <section className="panel">
      <button type="button" className="toggle" onClick={() => setShown(!shown)}>
        {shown ? "Hide" : "Show"} what the Function was handed
      </button>
      {shown && (
        <dl className="facts">
          <dt>Address</dt>
          <dd>
            <code>{address}</code>
          </dd>
          <dt>Mount</dt>
          <dd>
            <code>{base === "" ? "(the root)" : base}</code>
          </dd>
          <dt>Where its files answer</dt>
          <dd>
            <code>{assetUrl(base, "assets/")}</code>
          </dd>
        </dl>
      )}
    </section>
  );
}

function ActivityPending() {
  return (
    <section className="panel" aria-busy="true">
      <h2>Recent activity</h2>
      <p className="muted">Still loading — the rest of the page did not wait for it.</p>
    </section>
  );
}
