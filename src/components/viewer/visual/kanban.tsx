import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	GripVertical,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type Kanban, moveKanbanCard } from "@/lib/workspace/visual-documents";
import { fieldClass, IconButton } from "./controls";

const dragType = "application/x-agentero-kanban-card";

export function KanbanEditor({
	doc,
	onChange,
}: {
	doc: Kanban;
	onChange: (doc: Kanban) => void;
}) {
	const { t } = useTranslation("viewer");
	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const patchColumn = (
		id: string,
		changes: Partial<Kanban["columns"][number]>,
	) =>
		onChange({
			...doc,
			columns: doc.columns.map((column) =>
				column.id === id ? { ...column, ...changes } : column,
			),
		});
	const moveColumn = (index: number, delta: number) => {
		const columns = [...doc.columns];
		const [column] = columns.splice(index, 1);
		columns.splice(index + delta, 0, column);
		onChange({ ...doc, columns });
	};
	return (
		<div
			className="flex min-h-0 flex-1 gap-4 overflow-auto overscroll-contain bg-muted/20 p-4"
			data-kanban
		>
			{doc.columns.map((column, columnIndex) => (
				<section
					key={column.id}
					aria-label={column.title || t("visual.column")}
					className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 ${over === column.id ? "border-ring" : "border-transparent"}`}
					onDragOver={(event) => {
						if (dragging && event.dataTransfer.types.includes(dragType)) {
							event.preventDefault();
							event.dataTransfer.dropEffect = "move";
							setOver(column.id);
						}
					}}
					onDrop={(event) => {
						if (!dragging) return;
						event.preventDefault();
						event.stopPropagation();
						if (event.dataTransfer.getData(dragType) === dragging)
							onChange(moveKanbanCard(doc, dragging, column.id));
						setDragging(null);
						setOver(null);
					}}
				>
					<div className="flex items-center gap-1 px-2 pt-2">
						<input
							aria-label={t("visual.columnTitle")}
							className={`${fieldClass} w-full font-medium text-sm`}
							value={column.title}
							onChange={(event) =>
								patchColumn(column.id, { title: event.target.value })
							}
						/>
						<span className="text-muted-foreground text-xs tabular-nums">
							{column.cards.length}
						</span>
					</div>
					<div className="flex items-center px-2 pb-1">
						<IconButton
							label={t("visual.moveColumnLeft")}
							disabled={columnIndex === 0}
							onClick={() => moveColumn(columnIndex, -1)}
						>
							<ArrowLeft className="size-3.5" />
						</IconButton>
						<IconButton
							label={t("visual.moveColumnRight")}
							disabled={columnIndex === doc.columns.length - 1}
							onClick={() => moveColumn(columnIndex, 1)}
						>
							<ArrowRight className="size-3.5" />
						</IconButton>
						<div className="flex-1" />
						<IconButton
							label={t("visual.deleteColumn")}
							disabled={doc.columns.length === 1}
							onClick={() =>
								onChange({
									...doc,
									columns: doc.columns.filter(
										(entry) => entry.id !== column.id,
									),
								})
							}
						>
							<Trash2 className="size-3.5" />
						</IconButton>
					</div>
					<div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2 pb-2">
						{column.cards.map((card, index) => (
							<article
								key={card.id}
								data-card-id={card.id}
								className={`rounded-lg border bg-background p-2 shadow-sm ${dragging === card.id ? "opacity-40" : ""} ${over === card.id ? "border-t-ring border-t-2" : "border-border"}`}
								onDragOver={(event) => {
									if (!dragging) return;
									event.preventDefault();
									event.stopPropagation();
									setOver(card.id);
								}}
								onDrop={(event) => {
									if (!dragging) return;
									event.preventDefault();
									event.stopPropagation();
									if (event.dataTransfer.getData(dragType) === dragging)
										onChange(moveKanbanCard(doc, dragging, column.id, card.id));
									setDragging(null);
									setOver(null);
								}}
							>
								<div className="flex items-start">
									<IconButton
										label={t("visual.dragCard")}
										className="size-8 shrink-0 cursor-grab active:cursor-grabbing"
										draggable
										onDragStart={(event) => {
											event.stopPropagation();
											event.dataTransfer.setData(dragType, card.id);
											event.dataTransfer.effectAllowed = "move";
											setDragging(card.id);
										}}
										onDragEnd={() => {
											setDragging(null);
											setOver(null);
										}}
									>
										<GripVertical className="size-4 text-muted-foreground" />
									</IconButton>
									<textarea
										aria-label={t("visual.cardTitle")}
										rows={2}
										className={`${fieldClass} w-full resize-y text-sm`}
										value={card.title}
										onChange={(event) =>
											patchColumn(column.id, {
												cards: column.cards.map((entry) =>
													entry.id === card.id
														? { ...entry, title: event.target.value }
														: entry,
												),
											})
										}
									/>
								</div>
								<textarea
									aria-label={t("visual.description")}
									placeholder={t("visual.description")}
									rows={2}
									className={`${fieldClass} mt-1 w-full resize-y text-muted-foreground text-xs`}
									value={card.description}
									onChange={(event) =>
										patchColumn(column.id, {
											cards: column.cards.map((entry) =>
												entry.id === card.id
													? { ...entry, description: event.target.value }
													: entry,
											),
										})
									}
								/>
								<div className="mt-1 flex items-center gap-1">
									<select
										aria-label={t("visual.moveCard")}
										className={`${fieldClass} flex-1 text-xs`}
										value={column.id}
										onChange={(event) =>
											onChange(moveKanbanCard(doc, card.id, event.target.value))
										}
									>
										{doc.columns.map((entry) => (
											<option key={entry.id} value={entry.id}>
												{entry.title || t("visual.column")}
											</option>
										))}
									</select>
									<IconButton
										label={t("visual.moveUp")}
										disabled={index === 0}
										onClick={() =>
											onChange(
												moveKanbanCard(
													doc,
													card.id,
													column.id,
													column.cards[index - 1].id,
												),
											)
										}
									>
										<ArrowUp className="size-3.5" />
									</IconButton>
									<IconButton
										label={t("visual.moveDown")}
										disabled={index === column.cards.length - 1}
										onClick={() =>
											onChange(
												moveKanbanCard(
													doc,
													card.id,
													column.id,
													column.cards[index + 2]?.id,
												),
											)
										}
									>
										<ArrowDown className="size-3.5" />
									</IconButton>
									<IconButton
										label={t("visual.deleteCard")}
										onClick={() =>
											patchColumn(column.id, {
												cards: column.cards.filter(
													(entry) => entry.id !== card.id,
												),
											})
										}
									>
										<Trash2 className="size-3.5" />
									</IconButton>
								</div>
							</article>
						))}
						<Button
							variant="ghost"
							className="w-full justify-start text-muted-foreground"
							onClick={() =>
								patchColumn(column.id, {
									cards: [
										...column.cards,
										{
											id: crypto.randomUUID(),
											title: t("visual.card"),
											description: "",
										},
									],
								})
							}
						>
							<Plus className="size-4" />
							{t("visual.addCard")}
						</Button>
					</div>
				</section>
			))}
			<Button
				variant="outline"
				className="shrink-0"
				onClick={() =>
					onChange({
						...doc,
						columns: [
							...doc.columns,
							{ id: crypto.randomUUID(), title: t("visual.column"), cards: [] },
						],
					})
				}
			>
				<Plus className="size-4" />
				{t("visual.addColumn")}
			</Button>
		</div>
	);
}
