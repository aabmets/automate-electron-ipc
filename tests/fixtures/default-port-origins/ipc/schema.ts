import { defineChannels, invoke } from "automate-electron-ipc";

// An origin never has the default port of its scheme, so these entries can never match as written.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["http://localhost:80", "https://example.com:443"],
   }),
});
