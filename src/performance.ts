// Performance monitoring utilities
export class PerformanceMonitor {
    private metrics: Map<string, number[]> = new Map();
    private timers: Map<string, number> = new Map();

    startTimer(label: string): void {
        this.timers.set(label, performance.now());
    }

    endTimer(label: string): number {
        const startTime = this.timers.get(label);
        if (!startTime) {
            console.warn(`Timer '${label}' was not started`);
            return 0;
        }

        const duration = performance.now() - startTime;
        this.timers.delete(label);

        // Store metric
        if (!this.metrics.has(label)) {
            this.metrics.set(label, []);
        }
        this.metrics.get(label)!.push(duration);

        // Keep only last 100 measurements
        const measurements = this.metrics.get(label)!;
        if (measurements.length > 100) {
            measurements.shift();
        }

        return duration;
    }

    getMetrics(label: string): { avg: number; min: number; max: number; count: number } | null {
        const measurements = this.metrics.get(label);
        if (!measurements || measurements.length === 0) {
            return null;
        }

        const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
        const min = Math.min(...measurements);
        const max = Math.max(...measurements);

        return { avg, min, max, count: measurements.length };
    }

    logMetrics(): void {
        console.group('Performance Metrics');
        for (const [label, _] of this.metrics) {
            const metrics = this.getMetrics(label);
            if (metrics) {
                console.log(`${label}:`, {
                    avg: `${metrics.avg.toFixed(2)}ms`,
                    min: `${metrics.min.toFixed(2)}ms`,
                    max: `${metrics.max.toFixed(2)}ms`,
                    count: metrics.count
                });
            }
        }
        console.groupEnd();
    }

    clear(): void {
        this.metrics.clear();
        this.timers.clear();
    }
}

export const performanceMonitor = new PerformanceMonitor();

import type { Request, Response, NextFunction } from 'express';

export function performanceMiddleware(req: Request, res: Response, next: NextFunction) {
    const label = `request:${req.method}-${req.path}`;
    performanceMonitor.startTimer(label);
    res.on('finish', () => {
        performanceMonitor.endTimer(label);
    });
    next();
}

// Memory usage monitoring
export function logMemoryUsage(): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
        const usage = process.memoryUsage();
        console.log('Memory Usage:', {
            rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`
        });
    }
}

// Database query performance wrapper
export function withPerformanceTracking<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    label: string,
    monitor: PerformanceMonitor
) {
    return async (...args: T): Promise<R> => {
        monitor.startTimer(label);
        try {
            const result = await fn(...args);
            const duration = monitor.endTimer(label);

            if (duration > 1000) { // Log slow queries
                console.warn(`Slow operation detected: ${label} took ${duration.toFixed(2)}ms`);
            }

            return result;
        } catch (error) {
            monitor.endTimer(label);
            throw error;
        }
    };
}
