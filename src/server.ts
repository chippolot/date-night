// Local server. `bun run dev` (alias `bun run web`) runs it with --hot, which
// re-evaluates this module on every edit and so clears the cache below.
import { clientAssets } from "./assets";
import { loadData } from "./lib/data";
import { todayInSeattle } from "./lib/recurrence";
import { type Asset, renderSite } from "./site";

const port = Number(process.env.PORT ?? 3000);

// Rendering the whole site takes tens of ms, so do it once and share the result
// (including with concurrent requests that arrive while a build is in flight).
let cache: { today: string; files: Promise<Map<string, Asset>> } | undefined;

function site(): Promise<Map<string, Asset>> {
	const today = todayInSeattle();
	if (cache?.today !== today) {
		const files = (async () =>
			new Map([
				...renderSite(loadData(), today),
				...(await clientAssets(false)),
			]))();
		cache = { today, files };
		files.catch(() => {
			cache = undefined; // Don't cache a failed build; retry on the next request.
		});
	}
	return cache.files;
}

Bun.serve({
	port,
	development: true,
	async fetch(req) {
		const { pathname } = new URL(req.url);
		const files = await site();
		const asset =
			files.get(pathname) ??
			files.get(
				pathname.endsWith("/")
					? `${pathname}index.html`
					: `${pathname}/index.html`,
			);
		if (!asset) return new Response("Not found", { status: 404 });
		return new Response(asset.body, {
			headers: { "content-type": asset.type },
		});
	},
});

await site(); // Warm the cache so the first page load is fast too.
console.log(`Server on http://localhost:${port}`);
