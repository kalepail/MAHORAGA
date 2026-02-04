import { useState, useRef, useEffect, ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children?: ReactNode;
  /** Position relative to the trigger element */
  position?: "top" | "bottom" | "left" | "right";
  /** Max width of the tooltip in pixels */
  maxWidth?: number;
}

/**
 * Info icon with tooltip that displays on hover.
 * If children are provided, wraps them as the trigger.
 * Otherwise, renders a small 'i' icon as the trigger.
 */
export function Tooltip({
  content,
  children,
  position = "top",
  maxWidth = 280,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current && tooltipRef.current) {
      const trigger = triggerRef.current.getBoundingClientRect();
      const tooltip = tooltipRef.current.getBoundingClientRect();
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      let top = 0;
      let left = 0;

      switch (position) {
        case "top":
          top = trigger.top + scrollY - tooltip.height - 8;
          left = trigger.left + scrollX + trigger.width / 2 - tooltip.width / 2;
          break;
        case "bottom":
          top = trigger.bottom + scrollY + 8;
          left = trigger.left + scrollX + trigger.width / 2 - tooltip.width / 2;
          break;
        case "left":
          top = trigger.top + scrollY + trigger.height / 2 - tooltip.height / 2;
          left = trigger.left + scrollX - tooltip.width - 8;
          break;
        case "right":
          top = trigger.top + scrollY + trigger.height / 2 - tooltip.height / 2;
          left = trigger.right + scrollX + 8;
          break;
      }

      // Keep tooltip within viewport
      const padding = 8;
      if (left < padding) left = padding;
      if (left + tooltip.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltip.width - padding;
      }
      if (top < padding + scrollY) top = padding + scrollY;

      setCoords({ top, left });
    }
  }, [visible, position]);

  const trigger = children ?? (
    <svg
      className="w-[14px] h-[14px] cursor-help text-hud-text-dim hover:text-hud-text transition-colors"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <circle cx="7" cy="7" r="6" />
      <line x1="7" y1="6" x2="7" y2="10" strokeLinecap="round" />
      <circle cx="7" cy="4" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        tabIndex={0}
        role="button"
        aria-describedby={visible ? "tooltip" : undefined}
      >
        {trigger}
      </span>
      {visible && (
        <div
          ref={tooltipRef}
          id="tooltip"
          role="tooltip"
          className="fixed z-50 px-3 py-2 bg-hud-bg-panel border border-hud-line text-[11px] text-hud-text leading-relaxed shadow-lg normal-case font-normal text-left whitespace-normal"
          style={{
            maxWidth,
            top: coords.top,
            left: coords.left,
          }}
        >
          {content}
        </div>
      )}
    </>
  );
}

/**
 * Standalone info icon component for use next to labels.
 */
export function InfoIcon({ tooltip, position = "top", maxWidth }: {
  tooltip: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  maxWidth?: number;
}) {
  return (
    <Tooltip content={tooltip} position={position} maxWidth={maxWidth} />
  );
}
