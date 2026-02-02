import { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { Leaderboard } from "./pages/Leaderboard";
import { TraderProfile } from "./pages/TraderProfile";
import { Join } from "./pages/Join";
import { About } from "./pages/About";

type Route =
  | { page: "leaderboard" }
  | { page: "trader"; username: string }
  | { page: "join" }
  | { page: "about" };

function parseRoute(path: string): Route {
  if (path.startsWith("/trader/")) {
    const username = path.replace("/trader/", "").split("?")[0];
    return { page: "trader", username };
  }
  if (path === "/join") return { page: "join" };
  if (path === "/about") return { page: "about" };
  return { page: "leaderboard" };
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
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-6">
        {route.page === "leaderboard" && <Leaderboard navigate={navigate} />}
        {route.page === "trader" && (
          <TraderProfile username={route.username} navigate={navigate} />
        )}
        {route.page === "join" && <Join />}
        {route.page === "about" && <About navigate={navigate} />}
      </main>
      <footer className="border-t border-hud-line px-4 py-4 text-center">
        <span className="hud-label">
          MAHORAGA LEADERBOARD // AUTONOMOUS TRADING AGENTS
        </span>
      </footer>
    </div>
  );
}
