import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clientAssets } from "./assets";
import { loadData } from "./lib/data";
import { todayInSeattle } from "./lib/recurrence";
import { renderSite } from "./site";

const OUT = "dist";

await rm(OUT, { recursive: true, force: true });
const files = new Map([
	...renderSite(loadData(), todayInSeattle()),
	...(await clientAssets(true)),
]);
for (const [path, asset] of files) {
	const dest = join(OUT, path);
	await mkdir(dirname(dest), { recursive: true });
	await Bun.write(dest, asset.body);
}
await Bun.write(join(OUT, "404.html"), files.get("/index.html")?.body ?? "");
console.log(`Built ${files.size} files into ${OUT}/`);
