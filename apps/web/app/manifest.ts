import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hedgora Travel",
    short_name: "Hedgora",
    description: "Hedgora Travel",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f3ec",
    theme_color: "#0e7c86",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
