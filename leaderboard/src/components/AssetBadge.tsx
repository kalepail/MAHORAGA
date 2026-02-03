import clsx from "clsx";

interface AssetBadgeProps {
  assetClass: "stocks" | "crypto" | "both";
}

const config = {
  stocks: { label: "STOCKS", color: "text-hud-coral border-hud-coral/40" },
  crypto: { label: "CRYPTO", color: "text-hud-violet border-hud-violet/40" },
  both: { label: "BOTH", color: "text-hud-teal border-hud-teal/40" },
};

export function AssetBadge({ assetClass }: AssetBadgeProps) {
  const { label, color } = config[assetClass] || config.stocks;

  return (
    <span
      className={clsx(
        "inline-block text-[9px] tracking-[0.15em] uppercase border px-[6px] py-[2px]",
        color
      )}
    >
      {label}
    </span>
  );
}
