// One line-icon set for navigation: 24px grid, 1.8 stroke, round joins, currentColor.
import type { ReactNode, SVGProps } from "react";

export type IconName = "compass" | "map" | "route" | "heart" | "sparkles" | "luggage" | "wallet" | "shield";

const PATHS: Record<IconName, ReactNode> = {
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.4 8.6-1.9 4.9-4.9 1.9 1.9-4.9z" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8z" />
      <path d="M9 4.5v12.7M15 6.8v12.7" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18h6.3a3.3 3.3 0 0 0 0-6.6h-5a3.3 3.3 0 0 1 0-6.6h6.3" />
    </>
  ),
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 6.9a4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z" />,
  sparkles: (
    <>
      <path d="M11 3.5 12.7 8a2 2 0 0 0 1.3 1.3l4.5 1.7-4.5 1.7a2 2 0 0 0-1.3 1.3L11 18.5 9.3 14a2 2 0 0 0-1.3-1.3L3.5 11 8 9.3A2 2 0 0 0 9.3 8z" />
      <path d="M18.5 15.5v4M16.5 17.5h4" />
    </>
  ),
  luggage: (
    <>
      <rect x="5" y="7.5" width="14" height="12" rx="2.5" />
      <path d="M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9M9.5 11.5v4.5M14.5 11.5v4.5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.5" y="6.5" width="17" height="12.5" rx="2.5" />
      <path d="M20.5 10.8h-3.7a1.95 1.95 0 0 0 0 3.9h3.7M6 6.5l8.8-2.4a1.5 1.5 0 0 1 1.9 1.1l.3 1.3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5.5 6v5.3c0 4 2.8 7.3 6.5 8.7 3.7-1.4 6.5-4.7 6.5-8.7V6z" />
      <path d="m9.3 12 1.9 1.9 3.6-3.8" />
    </>
  ),
};

export default function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
