import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Toura",
    short_name: "Toura",
    description: "Toura — AI travel planner that pays each place in USDC only when you arrive",
    start_url: "/",
    display: "standalone",
    background_color: "#061513",
    theme_color: "#061513",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
