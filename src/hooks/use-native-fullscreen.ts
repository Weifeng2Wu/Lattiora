import { useEffect, useState } from "react";
export function useNativeFullscreen(): boolean {
	const [fullscreen, setFullscreen] = useState(
		Boolean(document.fullscreenElement),
	);
	useEffect(() => {
		const update = () => setFullscreen(Boolean(document.fullscreenElement));
		document.addEventListener("fullscreenchange", update);
		return () => document.removeEventListener("fullscreenchange", update);
	}, []);
	return fullscreen;
}
