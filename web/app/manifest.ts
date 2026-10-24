import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ecurious Reserve",
    short_name: "Reserve",
    description: "Find public EV chargers and reserve an Ecurious bay.",
    start_url: "/explore",
    display: "standalone",
    background_color: "#f5f4f1",
    theme_color: "#f5f4f1",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
