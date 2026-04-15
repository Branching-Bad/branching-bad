import { useCallback, useEffect, useState } from "react";

export const ROUTES = [
  "board",
  "analyst",
  "workflow",
  "extensions",
  "agents",
  "rules",
  "memories",
  "glossary",
  "repos",
  "data",
] as const;

export type Route = typeof ROUTES[number];

const DEFAULT_ROUTE: Route = "board";

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  return (ROUTES as readonly string[]).includes(clean) ? (clean as Route) : DEFAULT_ROUTE;
}

export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((r: Route) => {
    if (window.location.hash.replace(/^#/, "") !== r) {
      window.location.hash = r;
    }
  }, []);

  return { route, navigate };
}
