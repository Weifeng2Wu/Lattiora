import { ignore, type PdfEngine } from "@embedpdf/models";
import pdfiumWasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { errorText } from "@/lib/core/error";
import { logger } from "@/lib/core/logger";
import { loadSystemCjkFontFallback } from "@/lib/pdf/system-font-fallback";

type PdfEngineContextValue = {
	engine: PdfEngine | null;
	isLoading: boolean;
	error: Error | null;
};

const PdfEngineContext = createContext<PdfEngineContextValue>({
	engine: null,
	isLoading: true,
	error: null,
});

/** Both patched engine factories expose a readiness probe for the host. */
type ProbedPdfEngine = PdfEngine & {
	whenReady?: () => { toPromise(): Promise<unknown> };
};

/**
 * The worker engine runs PDFium WASM off the main thread, but its blob-URL
 * worker can fail to boot in some embedded webviews. Wait at most this long
 * for the worker readiness handshake before falling back to the main-thread
 * engine (older library versions never settled at all — silent "loading").
 */
const WORKER_READY_TIMEOUT_MS = 8000;

/**
 * Remember a failed worker probe for the process lifetime: remounts (vault
 * switch, StrictMode) go straight to the direct engine instead of paying the
 * probe timeout again.
 */
let workerEngineUsable: boolean | null = null;

function disposePdfEngine(engine: PdfEngine): void {
	const destroy = () => {
		engine.destroy?.().wait(ignore, ignore);
	};
	engine.closeAllDocuments().wait(destroy, destroy);
}

/**
 * Blob-URL workers resolve relative URLs against the blob itself, not the
 * page. Always hand the worker an absolute wasm URL.
 */
function absoluteWasmUrl(): string {
	if (typeof document === "undefined") return pdfiumWasmUrl;
	try {
		return new URL(pdfiumWasmUrl, document.baseURI).href;
	} catch {
		return pdfiumWasmUrl;
	}
}

function waitEngineReady(engine: ProbedPdfEngine): Promise<void> {
	const ready = engine.whenReady?.();
	if (!ready) return Promise.resolve();
	return ready.toPromise().then(() => undefined);
}

async function createWorkerPdfEngine(
	fontFallback: Awaited<ReturnType<typeof loadSystemCjkFontFallback>>,
): Promise<ProbedPdfEngine> {
	const { createPdfiumEngine } = await import(
		"@embedpdf/engines/pdfium-worker-engine"
	);
	return createPdfiumEngine(absoluteWasmUrl(), { fontFallback });
}

async function createDirectPdfEngine(
	fontFallback: Awaited<ReturnType<typeof loadSystemCjkFontFallback>>,
): Promise<ProbedPdfEngine> {
	const { createPdfiumEngine } = await import(
		"@embedpdf/engines/pdfium-direct-engine"
	);
	return createPdfiumEngine(pdfiumWasmUrl, { fontFallback });
}

/**
 * Create the app-wide PDFium engine. Prefers the worker engine (PDFium WASM
 * off the main thread → smooth zoom/scroll); verifies it with a readiness
 * handshake + timeout and falls back to the main-thread engine when the
 * worker cannot boot in this webview. The wasm binary is bundled as a local
 * asset (offline-first Tauri). Missing CJK fonts are supplied from a local
 * system-font blob, so no external font requests are made.
 */
async function initPdfEngine(): Promise<ProbedPdfEngine> {
	const fontFallback = await loadSystemCjkFontFallback();
	if (workerEngineUsable !== false) {
		let probe: ProbedPdfEngine | null = null;
		try {
			probe = await createWorkerPdfEngine(fontFallback);
			await Promise.race([
				waitEngineReady(probe),
				new Promise<never>((_, reject) => {
					setTimeout(() => {
						reject(
							new Error(
								`PDF worker engine not ready within ${WORKER_READY_TIMEOUT_MS}ms`,
							),
						);
					}, WORKER_READY_TIMEOUT_MS);
				}),
			]);
			workerEngineUsable = true;
			logger.info("[pdf] engine: worker (off-main-thread PDFium)");
			return probe;
		} catch (error) {
			workerEngineUsable = false;
			if (probe) disposePdfEngine(probe);
			logger.warn(
				`[pdf] worker engine unavailable, falling back to main thread: ${errorText(
					error,
				)}`,
			);
		}
	}
	return createDirectPdfEngine(fontFallback);
}

function useAgenteroPdfEngine(): PdfEngineContextValue {
	const [state, setState] = useState<PdfEngineContextValue>({
		engine: null,
		isLoading: true,
		error: null,
	});

	useEffect(() => {
		let cancelled = false;
		let current: PdfEngine | null = null;

		initPdfEngine()
			.then((engine) => {
				if (cancelled) {
					disposePdfEngine(engine);
					return;
				}
				current = engine;
				setState({ engine, isLoading: false, error: null });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState({
					engine: null,
					isLoading: false,
					error: error instanceof Error ? error : new Error(String(error)),
				});
			});

		return () => {
			cancelled = true;
			if (current) disposePdfEngine(current);
			current = null;
		};
	}, []);

	return state;
}

/**
 * Creates the PDFium (WASM) engine once for the whole workspace window and
 * shares it with every PDF tab via context. PDFium holds many documents
 * concurrently, so a single engine backs all `<EmbedPDF>` providers.
 */
export function PdfEngineHost({ children }: { children: ReactNode }) {
	const { engine, isLoading, error } = useAgenteroPdfEngine();
	return (
		<PdfEngineContext.Provider value={{ engine, isLoading, error }}>
			{children}
		</PdfEngineContext.Provider>
	);
}

export function usePdfEngineContext(): PdfEngineContextValue {
	return useContext(PdfEngineContext);
}
