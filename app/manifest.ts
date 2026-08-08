import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TapTab — shared bills without the awkwardness",
    short_name: "TapTab",
    description:
      "Split shared bills in pounds, agree the total together and settle securely on Monad.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf9",
    theme_color: "#0e6574",
    orientation: "any",
    lang: "en-GB",
    categories: ["finance", "utilities"],
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
