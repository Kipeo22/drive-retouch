import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Drive Retouch Preview",
    description:
      "Simple non-destructive photo retouching on Google Drive preview.",
    version: "0.1.0",
    permissions: ["storage"],
    host_permissions: ["https://drive.google.com/*"],
  },
});
