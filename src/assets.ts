import { BASE, CARTO_KEY } from "./config";
import type { Asset } from "./site";

/** Bundle client scripts and collect static files, keyed by URL path. */
export async function clientAssets(
	minify: boolean,
): Promise<Map<string, Asset>> {
	const result = await Bun.build({
		entrypoints: ["src/client/app.ts", "src/client/map.ts"],
		target: "browser",
		minify,
		sourcemap: minify ? "none" : "inline",
		define: {
			"process.env.BASE_PATH": JSON.stringify(BASE),
			"process.env.CARTO_KEY": JSON.stringify(CARTO_KEY),
		},
	});
	if (!result.success) {
		throw new AggregateError(result.logs, "Client build failed");
	}
	const out = new Map<string, Asset>();
	for (const file of result.outputs) {
		out.set(`/${file.path.replace(/^\.\//, "")}`, {
			body: await file.text(),
			type: "text/javascript; charset=utf-8",
		});
	}
	const css = "text/css; charset=utf-8";
	out.set("/styles.css", {
		body: await Bun.file("src/styles.css").text(),
		type: css,
	});
	out.set("/leaflet.css", {
		body: await Bun.file("node_modules/leaflet/dist/leaflet.css").text(),
		type: css,
	});
	return out;
}
