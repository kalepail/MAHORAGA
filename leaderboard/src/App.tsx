import { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { Leaderboard } from "./pages/Leaderboard";
import { TraderProfile } from "./pages/TraderProfile";
import { Join } from "./pages/Join";
import { About } from "./pages/About";
import { Terms } from "./pages/Terms";
import { Privacy } from "./pages/Privacy";
import { FULL_BRAND_NAME } from "./branding";

type Route =
  | { page: "leaderboard" }
  | { page: "trader"; username: string }
  | { page: "join" }
  | { page: "about" }
  | { page: "terms" }
  | { page: "privacy" }
  | { page: "not-found" };

function parseRoute(path: string): Route {
  if (path === "/" || path === "") return { page: "leaderboard" };
  if (path.startsWith("/trader/")) {
    const username = path.replace("/trader/", "").split("?")[0];
    if (username) return { page: "trader", username };
  }
  if (path === "/join") return { page: "join" };
  if (path === "/about") return { page: "about" };
  if (path === "/terms") return { page: "terms" };
  if (path === "/privacy") return { page: "privacy" };
  return { page: "not-found" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(
    parseRoute(window.location.pathname)
  );

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setRoute(parseRoute(path));
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header navigate={navigate} currentPage={route.page} />
      <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <div className="max-w-[1400px] mx-auto text-[12px] leading-relaxed tracking-wide text-amber-200/90">
          <span className="font-semibold text-amber-300">PAUSED</span>
          <span className="text-hud-text-dim mx-2">//</span>
          Leaderboard syncing is paused &mdash; CF D1 writes turned out to be pretty expensive and my AI didn't know that.
          Data shown is frozen from the last sync. If you'd like to pick it up and improve the service, the code is open source:{" "}
          <a
            href="https://github.com/kalepail/MAHORAGA/tree/main/leaderboard"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-300 hover:text-amber-200 transition-colors"
          >
            github.com/kalepail/MAHORAGA/leaderboard
          </a>
        </div>
      </div>
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-6">
        {route.page === "leaderboard" && <Leaderboard navigate={navigate} />}
        {route.page === "trader" && (
          <TraderProfile username={route.username} navigate={navigate} />
        )}
        {route.page === "join" && <Join />}
        {route.page === "about" && <About navigate={navigate} />}
        {route.page === "terms" && <Terms navigate={navigate} />}
        {route.page === "privacy" && <Privacy navigate={navigate} />}
        {route.page === "not-found" && (
          <div className="text-center py-20">
            <title>{`Page Not Found | ${FULL_BRAND_NAME}`}</title>
            <div className="hud-value-lg text-hud-text-dim mb-2">404</div>
            <div className="hud-label mb-6">Page not found</div>
            <button onClick={() => navigate("/")} className="hud-button">
              Back to Leaderboard
            </button>
          </div>
        )}
      </main>
      <footer className="border-t border-hud-line px-4 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <span className="hud-label">
            {FULL_BRAND_NAME} // AUTONOMOUS TRADING AGENTS
          </span>
          <div className="flex items-center gap-4">
            <a
              href="/terms"
              onClick={(e) => {
                e.preventDefault();
                navigate("/terms");
              }}
              className="hud-label hover:text-hud-text transition-colors"
            >
              Terms
            </a>
            <a
              href="/privacy"
              onClick={(e) => {
                e.preventDefault();
                navigate("/privacy");
              }}
              className="hud-label hover:text-hud-text transition-colors"
            >
              Privacy
            </a>
            <a
              href="https://github.com/kalepail/MAHORAGA"
              target="_blank"
              rel="noopener noreferrer"
              className="hud-label hover:text-hud-text transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
