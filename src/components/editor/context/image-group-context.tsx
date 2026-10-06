"use client";

import * as React from "react";

export type ImageGroupContextValue = {
	/** 组内图片 onLoad 上报宽高比,供等高布局按比例分配宽度。 */
	reportRatio: (url: string, ratio: number) => void;
};

export const ImageGroupContext = React.createContext<
	ImageGroupContextValue | undefined
>(undefined);

export function useImageGroup(): ImageGroupContextValue | undefined {
	return React.useContext(ImageGroupContext);
}
