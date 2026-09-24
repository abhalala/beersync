import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beersync",
    short_name: "Beersync",
    description:
      "Co-DJ in the browser. Everyone in a sesh mixes the same decks and every device plays the mix in sync. beersync.fm",
    start_url: "/",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
