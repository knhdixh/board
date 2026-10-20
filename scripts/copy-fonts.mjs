// Self-host Excalidraw's fonts instead of loading them from a CDN.
import { cpSync, existsSync } from "node:fs";

const from = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const to = "public/fonts";
if (!existsSync(from)) throw new Error(`missing ${from}; run npm install`);
cpSync(from, to, { recursive: true });
