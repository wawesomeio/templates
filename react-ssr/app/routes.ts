import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/home.tsx"), route("books/:id", "routes/book.tsx")] satisfies RouteConfig;
