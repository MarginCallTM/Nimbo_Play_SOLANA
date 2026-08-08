/// <reference types="vite/client" />

// The build-time config the client reads via import.meta.env. Only
// VITE_-prefixed vars are exposed to the browser bundle (Vite rule).
interface ImportMetaEnv {
    // The game server's HTTP/WebSocket base URL, e.g. http://<vps-ip>:2567.
    // Absent in plain dev -> main.ts falls back to http://localhost:2567.
    readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
