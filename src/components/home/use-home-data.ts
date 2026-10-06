import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { cloudAiError } from "@/lib/cloud/ai";
import { subscribeCloudFiles } from "@/lib/cloud/files";
import {
	createHomeBoard,
	homeDoneColumn,
	loadHomeOverview,
	saveHomeBoard,
} from "@/lib/cloud/home";
import { notifyError } from "@/lib/core/notify";
import { libraryStore } from "@/lib/paper/library-store";
import { moveKanbanCard } from "@/lib/workspace/visual-documents";

const preferenceKey = "agentero-home-view-v1";
type Preferences = { board?: string; done: Record<string, string> };
function readPreferences(): Preferences {
	try {
		const value = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
		if (value && typeof value.done === "object" && value.done) return value;
	} catch {
		/* View preferences are optional. */
	}
	return { done: {} };
}

export function useHomeData() {
	const { t } = useTranslation(["app", "viewer", "common"]);
	const papers = useStore(libraryStore, (state) => state.papers);
	const [overview, setOverview] = useState<Awaited<
		ReturnType<typeof loadHomeOverview>
	> | null>(null);
	const [preferences, setPreferences] = useState(readPreferences);
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const id = ++generation.current;
		try {
			const next = await loadHomeOverview();
			if (id !== generation.current) return;
			setOverview(next);
			if (next.unavailable)
				notifyError(t("home.unavailableBoards", { count: next.unavailable }), {
					id: "home-boards",
				});
		} catch (error) {
			notifyError(cloudAiError(error));
		}
	}, [t]);
	useEffect(() => {
		void refresh();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = subscribeCloudFiles(() => {
			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), 150);
		});
		return () => {
			generation.current++;
			clearTimeout(timer);
			unsubscribe();
		};
	}, [refresh]);
	const choose = (next: Preferences) => {
		setPreferences(next);
		try {
			localStorage.setItem(preferenceKey, JSON.stringify(next));
		} catch {
			/* The current view still works. */
		}
	};
	const board =
		overview?.boards.find((item) => item.path === preferences.board) ??
		overview?.boards[0];
	const done = board
		? homeDoneColumn(board.doc, preferences.done[board.path])
		: null;
	const inbox = board?.doc.columns.find((column) => column.id !== done?.id);
	const cards = useMemo(
		() =>
			board?.doc.columns.flatMap((column) =>
				column.cards.map((card) => ({
					...card,
					columnId: column.id,
					columnTitle: column.title,
				})),
			) ?? [],
		[board],
	);
	const pending = cards.filter((card) => card.columnId !== done?.id);
	const completed = cards.filter((card) => card.columnId === done?.id);
	const read = papers.filter((paper) => paper.is_read).length;
	const run = async (operation: () => Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		try {
			await operation();
		} catch (error) {
			notifyError(cloudAiError(error));
		} finally {
			await refresh();
			running.current = false;
			setBusy(false);
		}
	};
	const add = () =>
		run(async () => {
			if (!title.trim()) return;
			if (board) {
				if (!inbox) return;
				await saveHomeBoard(board, {
					...board.doc,
					columns: board.doc.columns.map((column) =>
						column.id === inbox.id
							? {
									...column,
									cards: [
										...column.cards,
										{
											id: crypto.randomUUID(),
											title: title.trim(),
											description: "",
										},
									],
								}
							: column,
					),
				});
			} else {
				const path = await createHomeBoard(title.trim(), [
					t("viewer:visual.todo"),
					t("viewer:visual.doing"),
					t("viewer:visual.done"),
				]);
				choose({ ...preferences, board: path });
			}
			setTitle("");
		});
	const toggle = (cardId: string, checked: boolean) =>
		run(async () => {
			if (!board || !done || !inbox) return;
			await saveHomeBoard(
				board,
				moveKanbanCard(board.doc, cardId, checked ? done.id : inbox.id),
			);
		});

	return {
		overview,
		preferences,
		choose,
		board,
		done,
		inbox,
		cards,
		pending,
		completed,
		read,
		busy,
		title,
		setTitle,
		add,
		toggle,
		papers,
	};
}
