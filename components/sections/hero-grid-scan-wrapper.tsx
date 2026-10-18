'use client';

import { useGridScanConfig } from '@/hooks/use-grid-scan-config';
import { GridScan } from '../backgrounds/grid-scan';

export function HeroGridScanWrapper({
	onCanvasReady,
}: {
	onCanvasReady: () => void;
}) {
	const gridConfig = useGridScanConfig();

	return (
		<div className='absolute inset-0 pointer-events-none'>
			<GridScan
				{...gridConfig}
				onCanvasReady={onCanvasReady}
				className='w-full h-full pointer-events-auto'
			/>
		</div>
	);
}
