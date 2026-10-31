import { expect, test } from "bun:test";
import { clientAssets } from "../src/assets";

test("client scripts don't read process.env, which browsers don't have", async () => {
	for (const [path, asset] of await clientAssets(true)) {
		if (path.endsWith(".js")) expect(asset.body).not.toContain("process.env");
	}
});
