// Share buttons on cards: the phone's share sheet where there is one, otherwise copy the link.
// Used by the Tonight and Coming up pages (app.ts) and venue pages (venue.ts).

/** Share buttons need JS, so the pre-rendered HTML keeps them hidden. */
export function enableShare(root: ParentNode) {
	for (const button of root.querySelectorAll<HTMLElement>("[data-share]")) {
		button.hidden = false;
	}
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short note at the bottom of the screen, read out by screen readers. */
function toast(message: string) {
	let el = document.querySelector<HTMLElement>(".toast");
	if (!el) {
		el = document.createElement("p");
		el.className = "toast";
		el.setAttribute("role", "status");
		document.body.append(el);
	}
	el.textContent = message;
	el.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el?.classList.remove("show"), 2500);
}

/** The phone's share sheet where there is one; otherwise copy the text and link. */
async function share(button: HTMLElement) {
	const url = new URL(button.dataset.share ?? "", location.href).href;
	const text = button.dataset.shareText ?? "";
	if (navigator.share) {
		try {
			await navigator.share({ title: text, text, url });
			return;
		} catch (err) {
			// Closing the share sheet isn't an error worth reporting.
			if (err instanceof DOMException && err.name === "AbortError") return;
		}
	}
	try {
		await navigator.clipboard.writeText(`${text} ${url}`);
		toast("Link copied");
	} catch {
		toast("Couldn't copy the link");
	}
}

/** One listener for every share button, including ones rendered later. */
export function wireShare() {
	document.addEventListener("click", (e) => {
		const button = (e.target as Element).closest<HTMLElement>("[data-share]");
		if (button) share(button);
	});
}
