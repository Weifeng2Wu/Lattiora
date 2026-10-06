export {
	aggregateReadingHeatmap,
	documentPosition,
	emptyHeatmap,
	isEmptyHeatmap,
	meanRectY,
} from "@/lib/paper/reading-heatmap/aggregate";
export {
	heatmapCacheKey,
	loadReadingHeatmaps,
	type ReadingHeatmapBatch,
} from "@/lib/paper/reading-heatmap/load";
export {
	EMPTY_READING_HEATMAP,
	READING_HEATMAP_BIN_COUNT,
	type ReadingActivityKind,
	type ReadingActivityPoint,
	type ReadingHeatmap,
} from "@/lib/paper/reading-heatmap/types";
