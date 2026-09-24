import { data, Link } from "react-router";
import { getBook } from "../books";
import type { Route } from "./+types/book";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData.book.title }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const book = await getBook(params.id);
  if (!book) {
    throw data(null, { status: 404, statusText: "Not Found" });
  }
  return { book };
}

export default function Book({ loaderData: { book } }: Route.ComponentProps) {
  return (
    <>
      <p>
        <Link to="/">← Reading list</Link>
      </p>
      <h1>{book.title}</h1>
      <p className="muted">
        {book.author}, {book.year}
      </p>
      <p>{book.summary}</p>
    </>
  );
}
