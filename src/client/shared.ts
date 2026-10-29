import { href } from "../config";
import type { SiteData } from "../lib/data";
import { type Filters, parseFilters, toQuery } from "../lib/filters";

export async function loadSiteData(): Promise<SiteData> {
	const res = await fetch(href("/data.json"));
	return res.json();
}

/** Upgrade the GET filter form to update the URL and re-render on every change. */
export function wireFilters(onChange: (f: Filters) => void): Filters {
	const form = document.querySelector<HTMLFormElement>("[data-filters]");
	const initial = parseFilters(new URLSearchParams(location.search));
	if (!form) return initial;
	form.classList.add("js");

	// The pre-rendered form has no selections; reflect the URL's filters.
	const params = new URLSearchParams(location.search);
	for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
		const values = params.getAll(input.name);
		input.checked =
			input.type === "radio" && input.value === ""
				? values.length === 0
				: values.includes(input.value);
	}
	// Day and time sit outside the panel, so only open it for the filters inside.
	if (
		initial.hood.length ||
		initial.cat.length ||
		initial.vibe.length ||
		initial.price
	)
		form.querySelector("details")?.setAttribute("open", "");

	const read = () =>
		parseFilters(new URLSearchParams(new FormData(form) as never));
	form.addEventListener("change", () => {
		const f = read();
		history.replaceState(null, "", `${location.pathname}${toQuery(f)}`);
		onChange(f);
	});
	form.addEventListener("submit", (e) => e.preventDefault());
	form.querySelector("[data-clear]")?.addEventListener("click", (e) => {
		e.preventDefault();
		form.reset();
		for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
			input.checked = input.type === "radio" && input.value === "";
		}
		form.dispatchEvent(new Event("change"));
	});
	return initial;
}
