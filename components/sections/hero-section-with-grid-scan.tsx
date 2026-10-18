'use client';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { HeroSection } from './hero-section';

function StaticGridBackground({ className = '' }: { className?: string }) {
	return (
		<div
			className={cn('absolute inset-0 pointer-events-none', className)}
			aria-hidden='true'
		>
			<div
				className='absolute inset-0 opacity-20 dark:opacity-15'
				style={{
					backgroundImage: `
						linear-gradient(to right, currentColor 1px, transparent 1px),
						linear-gradient(to bottom, currentColor 1px, transparent 1px)
					`,
					backgroundSize: '60px 60px',
				}}
			/>
			<div className='absolute inset-0 bg-linear-to-b from-background via-transparent to-background' />
			<div className='absolute inset-0 bg-linear-to-r from-background via-transparent to-background opacity-50' />
			<div
				className='absolute inset-0'
				style={{
					background:
						'radial-gradient(ellipse at center, transparent 0%, hsl(var(--background)) 70%)',
				}}
			/>
		</div>
	);
}

// Lazy load the heavy GridScan wrapper (THREE.js, postprocessing ~1MB+)
// This prevents blocking FCP/LCP with heavy JavaScript parsing.
// The static grid is always rendered underneath by the parent, so the
// loading state needs no placeholder - the canvas crossfades in over it.
const GridScanWithConfig = dynamic(
	() =>
		import('./hero-grid-scan-wrapper').then((mod) => ({
			default: mod.HeroGridScanWrapper,
		})),
	{
		ssr: false,
		loading: () => null,
	},
);

// Settles to true right after hydration, in the same render pass where
// useReducedMotion flips to the actual client values. Using it to gate the
// dynamic import guarantees GridScan is never rendered - and the three.js
// chunk is never even fetched - with a stale server default.
function subscribeNoop(): () => void {
	return () => {};
}

function getHydratedSnapshot(): boolean {
	return true;
}

function getHydratedServerSnapshot(): boolean {
	return false;
}

function HeroSectionWithGridScan() {
	const { shouldReduceMotion } = useReducedMotion();
	const isHydrated = useSyncExternalStore(
		subscribeNoop,
		getHydratedSnapshot,
		getHydratedServerSnapshot,
	);
	const [canvasActive, setCanvasActive] = useState(false);

	const handleCanvasReady = useCallback(() => setCanvasActive(true), []);

	return (
		<div className='relative min-h-screen w-full'>
			{/* Shared first-paint base for both versions. Once the WebGL canvas
			    starts its fade-in, the static grid fades out over the same
			    duration, so exactly one background is visible at full strength.
			    If motion is disabled mid-session, the static grid comes back */}
			<StaticGridBackground
				className={cn(
					'[transition:opacity_0.8s_ease]',
					canvasActive && !shouldReduceMotion && 'opacity-0',
				)}
			/>
			{isHydrated && !shouldReduceMotion && (
				<GridScanWithConfig onCanvasReady={handleCanvasReady} />
			)}
			<HeroSection />
		</div>
	);
}

export { HeroSectionWithGridScan };
