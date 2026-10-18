'use client';

import { useSyncExternalStore } from 'react';

interface ReducedMotionConfig {
	/** True if user prefers reduced motion */
	prefersReducedMotion: boolean;
	/** True if device is low-end (limited hardware) */
	isLowEndDevice: boolean;
	/** True if animations should be disabled (either reduced motion or low-end device) */
	shouldReduceMotion: boolean;
}

let cachedIsLowEndDevice: boolean | null = null;
const lowEndListeners = new Set<() => void>();

function notifyLowEndListeners(): void {
	for (const listener of lowEndListeners) {
		listener();
	}
}

function checkLowEndDevice(): boolean {
	// Always return false on server - we'll check properly on client
	if (typeof window === 'undefined') {
		return false;
	}

	// Return the cached value (it never becomes null again after the first call)
	if (cachedIsLowEndDevice !== null) {
		return cachedIsLowEndDevice;
	}

	let isLowEnd = false;

	try {
		// 1. Device Memory API (Chrome/Edge) - < 4GB is considered low-end
		const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
			.deviceMemory;

		if (deviceMemory !== undefined && deviceMemory <= 4) {
			isLowEnd = true;
		}

		// 2. Hardware concurrency (CPU cores) - < 4 cores is low-end
		if (
			navigator.hardwareConcurrency !== undefined &&
			navigator.hardwareConcurrency <= 4
		) {
			isLowEnd = true;
		}

		// 3. Network Information API - check if user prefers data saving
		const connection = (
			navigator as Navigator & {
				connection?: {
					saveData?: boolean;
					effectiveType?: string;
					downlink?: number;
					rtt?: number;
				};
			}
		).connection;

		if (connection) {
			// Save-data header indicates user wants lighter experience
			if (connection.saveData === true) {
				isLowEnd = true;
			}

			// Check for slow connection types
			if (
				connection.effectiveType &&
				['slow-2g', '2g', '3g'].includes(connection.effectiveType)
			) {
				isLowEnd = true;
			}

			// Check actual downlink speed (< 1.5 Mbps is slow)
			if (connection.downlink !== undefined && connection.downlink < 1.5) {
				isLowEnd = true;
			}

			// Check round-trip time (> 400ms is slow)
			if (connection.rtt !== undefined && connection.rtt > 400) {
				isLowEnd = true;
			}
		}

		// 4. User Agent detection for known low-end devices
		const ua = navigator.userAgent.toLowerCase();
		const lowEndPatterns = [
			/android.*;\s*(sm-[ajng]\d{3}|gt-[ips]\d{4})/i, // Older Samsung devices
			/android\s[1-4]\./i, // Android 4.x and below
			/windows phone/i,
			/blackberry/i,
			/opera mini/i,
		];

		if (lowEndPatterns.some(pattern => pattern.test(ua))) {
			isLowEnd = true;
		}

		// 6. Performance memory check (if available)
		const performance = window.performance as Performance & {
			memory?: {
				jsHeapSizeLimit: number;
				totalJSHeapSize: number;
				usedJSHeapSize: number;
			};
		};

		if (performance.memory) {
			// If heap size limit is less than 1GB, consider low-end
			const heapLimitGB = performance.memory.jsHeapSizeLimit / (1024 ** 3);
			if (heapLimitGB < 1) {
				isLowEnd = true;
			}
		}

		// One-shot diagnostic in development: prints exactly what was measured
		// and why the verdict was reached, so misclassifications can be traced
		if (process.env.NODE_ENV !== 'production') {
			console.info(
				'[useReducedMotion] low-end check:',
				JSON.stringify({
					deviceMemory,
					hardwareConcurrency: navigator.hardwareConcurrency,
					saveData: connection?.saveData ?? null,
					effectiveType: connection?.effectiveType ?? null,
					downlink: connection?.downlink ?? null,
					rtt: connection?.rtt ?? null,
					uaFlagged: lowEndPatterns.some(pattern => pattern.test(ua)),
					heapLimitGB:
						performance.memory ?
							Math.round(
								(performance.memory.jsHeapSizeLimit / 1024 ** 3) * 10
							) / 10
						:	null,
					prefersReducedMotion: window.matchMedia(
						'(prefers-reduced-motion: reduce)'
					).matches,
					isLowEndDevice: isLowEnd,
					shouldReduceMotion: isLowEnd,
				})
			);
		}
	} catch (error) {
		// If any check fails, default to false (assume capable device)
		console.warn('Low-end device detection error:', error);
	}

	cachedIsLowEndDevice = isLowEnd;

	// 5. Battery level check (if on battery and < 20%, be conservative).
	// This is asynchronous, so it is resolved after the synchronous check above.
	// When it flips the answer, notify every subscriber so all components stay
	// in sync instead of silently diverging on their next read.
	if ('getBattery' in navigator) {
		(navigator as Navigator & {
			getBattery?: () => Promise<{
				level: number;
				charging: boolean;
			}>;
		})
			.getBattery?.()
			.then(battery => {
				if (!battery.charging && battery.level < 0.2) {
					if (cachedIsLowEndDevice === false) {
						cachedIsLowEndDevice = true;
						notifyLowEndListeners();
						if (process.env.NODE_ENV !== 'production') {
							console.info(
								'[useReducedMotion] battery flip: unplugged and level < 20% -> low-end'
							);
						}
					}
				}
			})
			.catch(() => {
				// Battery API failed, ignore
			});
	}

	return isLowEnd;
}

function subscribeToReducedMotion(callback: () => void): () => void {
	if (typeof window === 'undefined') return () => {};

	const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
	mediaQuery.addEventListener('change', callback);

	return () => {
		mediaQuery.removeEventListener('change', callback);
	};
}

function getReducedMotionSnapshot(): boolean {
	if (typeof window === 'undefined') return false;

	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getServerSnapshot(): boolean {
	return false;
}

function getLowEndDeviceSnapshot(): boolean {
	return checkLowEndDevice();
}

function subscribeToLowEndDevice(callback: () => void): () => void {
	if (typeof window === 'undefined') return () => {};

	lowEndListeners.add(callback);

	return () => {
		lowEndListeners.delete(callback);
	};
}

/**
 * Deliberate testing override: `?motion=reduced` forces the reduced version,
 * `?motion=full` forces the full version (e.g. to preview the high-end
 * experience while an OS reduced-motion preference is active). The reported
 * device/preference flags stay truthful; only the effective branch decision
 * is overridden.
 *
 * The override is applied only after hydration, so the first client render
 * always matches the server-rendered HTML (no hydration mismatch).
 */
function getForcedMotionPreference(): 'reduced' | 'full' | null {
	if (typeof window === 'undefined') return null;

	const param = new URLSearchParams(window.location.search).get('motion');
	return param === 'reduced' || param === 'full' ? param : null;
}

function subscribeNoop(): () => void {
	return () => {};
}

function getIsHydrated(): boolean {
	return true;
}

function getServerIsHydrated(): boolean {
	return false;
}

/**
 * Detects if the user has a preference for reduced motion or is using a low-end device.
 *
 * Checks:
 * - CSS prefers-reduced-motion media query
 * - Device memory API (< 4GB considered low-end)
 * - Hardware concurrency (< 4 cores considered low-end)
 * - Network Information API:
 *   - navigator.connection.saveData preference
 *   - navigator.connection.effectiveType indicates a slow connection (slow-2g, 2g, 3g)
 * - Battery status (low battery while unplugged)
 *
 * All values are computed synchronously once and cached, so the first
 * client render already matches the final state. Any late async change
 * (e.g. battery status) notifies every subscriber at once.
 *
 * @returns Configuration object with motion preference details
 */
export function useReducedMotion(): ReducedMotionConfig {
	const prefersReducedMotion = useSyncExternalStore(
		subscribeToReducedMotion,
		getReducedMotionSnapshot,
		getServerSnapshot
	);

	const isLowEndDevice = useSyncExternalStore(
		subscribeToLowEndDevice,
		getLowEndDeviceSnapshot,
		getServerSnapshot
	);

	const isHydrated = useSyncExternalStore(
		subscribeNoop,
		getIsHydrated,
		getServerIsHydrated
	);

	// Only apply ?motion= override after hydration to keep the SSR HTML
	// and the first client render identical
	const forced = isHydrated ? getForcedMotionPreference() : null;
	const baseShouldReduce = prefersReducedMotion || isLowEndDevice;

	return {
		prefersReducedMotion,
		isLowEndDevice,
		shouldReduceMotion:
			forced === 'reduced' || (forced === 'full' ? false : baseShouldReduce),
	};
}

/**
 * SSR-safe check for reduced motion.
 * Returns true on server (safe default), actual value on client.
 */
export function getReducedMotionSSR(): boolean {
	if (typeof window === 'undefined') return true;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
