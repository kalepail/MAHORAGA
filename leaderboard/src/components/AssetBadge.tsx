import clsx from "clsx";

interface AssetBadgeProps {
  assetClass: "stocks" | "crypto" | "both";
}

const config = {
  stocks: { label: "STOCKS", color: "text-hud-asset-stocks border-hud-asset-stocks/40" },
  crypto: { label: "CRYPTO", color: "text-hud-asset-crypto border-hud-asset-crypto/40" },
  both: { label: "BOTH", color: "text-hud-asset-both border-hud-asset-both/40" },
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
