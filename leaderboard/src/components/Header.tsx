import clsx from "clsx";
import { FULL_BRAND_NAME } from "../branding";

interface HeaderProps {
  navigate: (path: string) => void;
  currentPage: string;
}

const links = [
  { label: "Leaderboard", path: "/", page: "leaderboard" },
  { label: "Join", path: "/join", page: "join" },
  { label: "About", path: "/about", page: "about" },
];

export function Header({ navigate, currentPage }: HeaderProps) {
  return (
    <header className="border-b border-hud-line px-4">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between h-[48px]">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex items-center gap-3"
        >
          <span className="text-[12px] font-medium tracking-[0.08em] text-hud-text-bright">
            {FULL_BRAND_NAME}
          </span>
        </a>

        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <a
              key={link.path}
              href={link.path}
              onClick={(e) => {
                e.preventDefault();
                navigate(link.path);
              }}
              className={clsx(
                "font-mono text-[11px] uppercase tracking-[0.1em] px-3 py-2 transition-colors duration-200",
                currentPage === link.page
                  ? "text-hud-text-bright"
                  : "text-hud-text-dim hover:text-hud-text"
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
