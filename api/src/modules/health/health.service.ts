import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as process from 'process';

/**
 * Health Service
 * Provides system metrics and health information
 */
@Injectable()
export class HealthService {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get application metrics
   */
  getMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      uptime: this.getUptime(),
      memory: {
        rss: this.formatBytes(memoryUsage.rss),
        heapTotal: this.formatBytes(memoryUsage.heapTotal),
        heapUsed: this.formatBytes(memoryUsage.heapUsed),
        external: this.formatBytes(memoryUsage.external),
        arrayBuffers: this.formatBytes(memoryUsage.arrayBuffers),
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      process: {
        pid: process.pid,
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  /**
   * Get system information
   */
  getSystemInfo() {
    return {
      application: {
        name: 'InterviewAI Pro',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: this.getUptime(),
      },
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: this.formatBytes(os.totalmem()),
        freeMemory: this.formatBytes(os.freemem()),
        loadAverage: os.loadavg(),
      },
      node: {
        version: process.version,
        pid: process.pid,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get application uptime
   */
  private getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return {
      milliseconds: uptimeMs,
      seconds: uptimeSeconds,
      formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
    };
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): { bytes: number; readable: string } {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return {
      bytes,
      readable: `${size.toFixed(2)} ${units[unitIndex]}`,
    };
  }
}
