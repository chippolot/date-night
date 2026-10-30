// Swap a short-lived Meta user token (about 1 hour, from the Graph API Explorer) for a long-lived
// one (about 60 days) and save it to .env as META_ACCESS_TOKEN.
// `bun run meta-token` exchanges the META_ACCESS_TOKEN already in .env; `bun run meta-token <token>`
// exchanges the one given. Needs META_APP_ID and META_APP_SECRET in .env.
// Add `--github` to also save it as the repo's META_ACCESS_TOKEN secret (with the gh CLI) for the
// weekly Instagram leads workflow.
const ENV = ".env";

const appId = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
const args = process.argv.slice(2);
const toGitHub = args.includes("--github");
const shortToken =
	args.find((a) => !a.startsWith("--")) ?? process.env.META_ACCESS_TOKEN;
if (!appId || !appSecret || !shortToken) {
	console.error(
		"Needs META_APP_ID, META_APP_SECRET, and a token (META_ACCESS_TOKEN in .env or as an argument).",
	);
	process.exit(1);
}

const url = new URL("https://graph.facebook.com/oauth/access_token");
url.search = new URLSearchParams({
	grant_type: "fb_exchange_token",
	client_id: appId,
	client_secret: appSecret,
	fb_exchange_token: shortToken,
}).toString();

const res = await fetch(url);
const body = (await res.json()) as {
	access_token?: string;
	expires_in?: number;
	error?: { message: string };
};
if (!res.ok || !body.access_token) {
	console.error(`Exchange failed: ${body.error?.message ?? res.statusText}`);
	process.exit(1);
}

// Replace the META_ACCESS_TOKEN line in .env, or append one if it isn't there
const line = `META_ACCESS_TOKEN=${body.access_token}`;
const env = (await Bun.file(ENV).exists()) ? await Bun.file(ENV).text() : "";
const updated = /^META_ACCESS_TOKEN=.*$/m.test(env)
	? env.replace(/^META_ACCESS_TOKEN=.*$/m, line)
	: `${env}${env && !env.endsWith("\n") ? "\n" : ""}${line}\n`;
await Bun.write(ENV, updated);

const expires = body.expires_in
	? new Date(Date.now() + body.expires_in * 1000).toISOString().slice(0, 10)
	: "in about 60 days";
console.log(
	`Saved long-lived META_ACCESS_TOKEN to ${ENV} (expires ${expires}).`,
);

if (toGitHub) {
	const gh = Bun.spawnSync(["gh", "secret", "set", "META_ACCESS_TOKEN"], {
		stdin: new TextEncoder().encode(body.access_token),
		stdout: "inherit",
		stderr: "inherit",
	});
	if (gh.exitCode !== 0) {
		console.error(
			"Couldn't save the GitHub secret (is gh installed and logged in?).",
		);
		process.exit(1);
	}
	console.log("Saved it as the repo's META_ACCESS_TOKEN secret too.");
}
