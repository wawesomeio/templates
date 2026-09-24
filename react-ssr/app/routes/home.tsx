import { data, Form, Link, redirect, useNavigation } from "react-router";
import { listBooks } from "../books";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Reading list" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const suggested = new URL(request.url).searchParams.get("suggested");
  return { books: await listBooks(), suggested };
}

export async function action({ request }: Route.ActionArgs) {
  const title = String((await request.formData()).get("title") ?? "").trim();
  if (title === "") {
    return data({ error: "Give the book a title." }, { status: 400 });
  }
  return redirect(`/?suggested=${encodeURIComponent(title)}`);
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const submitting = useNavigation().state === "submitting";

  return (
    <>
      <h1>Reading list</h1>
      <ul className="books">
        {loaderData.books.map((book) => (
          <li key={book.id}>
            <Link to={`/books/${book.id}`}>{book.title}</Link>
            <span className="muted"> by {book.author}</span>
          </li>
        ))}
      </ul>

      <h2>Suggest a book</h2>
      {loaderData.suggested && <p className="notice">Thanks for suggesting "{loaderData.suggested}".</p>}
      <Form method="post" className="suggest">
        <input name="title" aria-label="Title" placeholder="Title" />
        <button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Suggest"}
        </button>
      </Form>
      {actionData?.error && <p className="error">{actionData.error}</p>}
    </>
  );
}
