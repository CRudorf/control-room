// `bun run open`: sign this browser in once and open the app.
import { bootstrapUrl } from "./security";

const url = bootstrapUrl();
console.log(`opening ${url.replace(/t=.*/, "t=…")}`);
await Bun.spawn(["open", "-a", "Google Chrome", url]).exited;
