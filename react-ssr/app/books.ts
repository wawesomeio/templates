export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  summary: string;
}

const books: Book[] = [
  {
    id: "left-hand-of-darkness",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    year: 1969,
    summary: "An envoy spends a winter on a planet whose people have no fixed sex.",
  },
  {
    id: "piranesi",
    title: "Piranesi",
    author: "Susanna Clarke",
    year: 2020,
    summary: "A man lives alone in a house of endless halls and a sea that rises through them.",
  },
  {
    id: "the-dispossessed",
    title: "The Dispossessed",
    author: "Ursula K. Le Guin",
    year: 1974,
    summary: "A physicist leaves an anarchist moon to work on the planet it broke away from.",
  },
];

export async function listBooks(): Promise<Book[]> {
  return books;
}

export async function getBook(id: string): Promise<Book | undefined> {
  return books.find((book) => book.id === id);
}
