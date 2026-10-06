import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	conferenceTimestamp,
	deadlineCountdown,
	nextConferenceRound,
	parseConferences,
	selectableConferences,
} from "../src/lib/cloud/conference-deadlines";

const source = [
	{
		title: "CONF",
		description: "Test conference",
		sub: "AI",
		rank: { ccf: "A" },
		confs: [
			{
				id: "conf30",
				year: 2030,
				link: "https://example.org/conf",
				timezone: "AoE",
				timeline: [
					{
						deadline: "2029-10-01 23:59:59",
						abstract_deadline: "2029-09-25 23:59:59",
						comment: "First round",
					},
					{ deadline: "2029-12-01 23:59:59", comment: "Second round" },
				],
			},
		],
	},
];

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => vi.unstubAllGlobals());

it("interprets AoE, signed UTC offsets and PT daylight saving independently of device timezone", () => {
	expect(conferenceTimestamp("2026-10-06 23:59:59", "AoE")).toBe(
		Date.parse("2026-10-07T11:59:59Z"),
	);
	expect(conferenceTimestamp("2026-10-06 23:59:59", "UTC-12")).toBe(
		Date.parse("2026-10-07T11:59:59Z"),
	);
	expect(conferenceTimestamp("2026-10-06 23:59:59", "UTC+5:30")).toBe(
		Date.parse("2026-10-06T18:29:59Z"),
	);
	expect(conferenceTimestamp("2026-07-06 23:59:59", "PT")).toBe(
		Date.parse("2026-07-07T06:59:59Z"),
	);
	expect(conferenceTimestamp("2026-01-06 23:59:59", "PT")).toBe(
		Date.parse("2026-01-07T07:59:59Z"),
	);
	for (const [date, zone] of [
		["TBD", "AoE"],
		["2026-02-30 23:59:59", "UTC"],
		["2026-10-06 23:59:59", "Unknown"],
		["2026-03-08 02:30:00", "PT"],
		["2026-11-01 01:30:00", "PT"],
	]) {
		expect(conferenceTimestamp(date, zone)).toBeNull();
	}
});

it("advances at submission boundaries, keeps abstract deadlines separate, and preserves TBD/closed states", () => {
	const [conference] = parseConferences(source);
	const first = Date.parse("2029-10-02T11:59:59Z");
	expect(nextConferenceRound(conference, first - 1)).toMatchObject({
		index: 0,
		at: first,
		abstractAt: Date.parse("2029-09-26T11:59:59Z"),
	});
	expect(nextConferenceRound(conference, first)).toMatchObject({
		index: 1,
		at: Date.parse("2029-12-02T11:59:59Z"),
	});
	expect(nextConferenceRound(conference, Date.parse("2030-01-01"))?.index).toBe(
		1,
	);
	expect(
		nextConferenceRound(
			{
				...conference,
				timeline: [...conference.timeline, { deadline: "TBD" }],
			},
			Date.parse("2030-01-01"),
		)?.at,
	).toBeNull();
	expect(deadlineCountdown(first, first - 86401001)).toEqual({
		days: 1,
		time: "00:00:02",
	});
	expect(deadlineCountdown(first, first + 1)).toEqual({
		days: 0,
		time: "00:00:00",
	});
});

it("offers latest editions and still-open older editions without unsafe website links", () => {
	const [conference] = parseConferences(source);
	const next = { ...conference, year: 2031, id: "conf31" };
	expect(
		selectableConferences([conference, next], Date.parse("2029-11-01")),
	).toHaveLength(2);
	expect(
		selectableConferences([conference, next], Date.parse("2030-01-01")),
	).toEqual([next]);
	const namesake = { ...conference, series: "SC/conf", id: "other-conf30" };
	expect(
		selectableConferences(
			[conference, next, namesake],
			Date.parse("2030-01-01"),
		),
	).toEqual([next, namesake]);
	const unsafe = structuredClone(source);
	unsafe[0].confs[0].link = "javascript:alert(1)";
	expect(parseConferences(unsafe)[0].link).toBe("");
	expect(() => parseConferences([{ title: "invalid" }])).toThrow();
});

it("uses the existing authenticated proxy, deduplicates refreshes and keeps a usable offline cache on failure", async () => {
	const fetchMock = vi.fn(async () =>
		Response.json({ status: 200, body: JSON.stringify(source) }),
	);
	vi.stubGlobal("fetch", fetchMock);
	const { readConferenceCatalog, refreshConferenceCatalog, CONFERENCE_SOURCE } =
		await import("../src/lib/cloud/conferences");
	expect(await readConferenceCatalog()).toBeNull();
	const [catalog, same] = await Promise.all([
		refreshConferenceCatalog(),
		refreshConferenceCatalog(),
	]);
	expect(catalog).toEqual(same);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock).toHaveBeenCalledWith(
		"/api/feeds/fetch",
		expect.objectContaining({
			method: "POST",
			body: JSON.stringify({ url: CONFERENCE_SOURCE }),
		}),
	);
	expect(await readConferenceCatalog()).toEqual(catalog);
	fetchMock.mockImplementationOnce(async () => {
		throw new Error("offline");
	});
	await expect(refreshConferenceCatalog()).rejects.toThrow("offline");
	expect(await readConferenceCatalog()).toEqual(catalog);
	fetchMock.mockImplementationOnce(async () =>
		Response.json({ status: 200, body: "[]" }),
	);
	await expect(refreshConferenceCatalog()).rejects.toThrow(
		"invalidConferences",
	);
	expect(await readConferenceCatalog()).toEqual(catalog);
	const { localTransaction } = await import("../src/lib/cloud/db");
	expect(
		await localTransaction(
			(files, state) => ({ files: files.size, cursor: state.cursor }),
			false,
		),
	).toEqual({ files: 0, cursor: 0 });
});
