import type { MetadataRoute } from "next";

/** Lets staff add the website to a phone or tablet home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bar & Restaurant",
    short_name: "Bar POS",
    description:
      "Billing, stock, rooms and reports for the bar and restaurant.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f2f4f3",
    theme_color: "#163029",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
