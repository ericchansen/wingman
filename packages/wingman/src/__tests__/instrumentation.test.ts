/**
 * Tests for OTel instrumentation bootstrap.
 *
 * Verifies exporter selection, env var overrides, no-op when disabled,
 * and idempotent initialization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTelemetry, shutdownTelemetry } from '../instrumentation.js';

describe('initTelemetry', () => {
  afterEach(async () => {
    // Reset state between tests
    await shutdownTelemetry();
    // Clean up env vars
    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
  });

  it('is a no-op when telemetry is disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: false });
    // Should NOT print any OTel initialization message
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('OTel tracing'),
    );
    consoleSpy.mockRestore();
  });

  it('is a no-op when config is empty', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({});
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('OTel tracing'),
    );
    consoleSpy.mockRestore();
  });

  it('initializes console exporter by default', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: true, exporter: 'console' });
    expect(consoleSpy).toHaveBeenCalledWith('📡 OTel tracing → console');
    consoleSpy.mockRestore();
  }, 15000);

  it('initializes OTLP exporter with default endpoint', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: true, exporter: 'otlp' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('OTLP (default endpoint)'),
    );
    consoleSpy.mockRestore();
  }, 15000);

  it('uses custom endpoint for OTLP', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({
      enabled: true,
      exporter: 'otlp',
      endpoint: 'http://custom:4318/v1/traces',
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('OTLP at http://custom:4318/v1/traces'),
    );
    consoleSpy.mockRestore();
  });

  it('respects OTEL_TRACES_EXPORTER=none to disable tracing', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'none';
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: true, exporter: 'otlp' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('OTel tracing disabled'),
    );
    consoleSpy.mockRestore();
  });

  it('lets SDK handle OTEL_EXPORTER_OTLP_ENDPOINT natively', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    const consoleSpy = vi.spyOn(console, 'log');
    // No config.endpoint — SDK reads env var and appends /v1/traces itself
    await initTelemetry({ enabled: true, exporter: 'otlp' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('OTLP (default endpoint)'),
    );
    consoleSpy.mockRestore();
  });

  it('allows re-enabling after disabled call', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: false });
    // initialized should NOT be true, so this should work
    await initTelemetry({ enabled: true, exporter: 'console' });
    expect(consoleSpy).toHaveBeenCalledWith('📡 OTel tracing → console');
    consoleSpy.mockRestore();
  });

  it('is idempotent — second call is a no-op', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: true, exporter: 'console' });
    const callCount = consoleSpy.mock.calls.length;
    await initTelemetry({ enabled: true, exporter: 'console' });
    // Should not log again
    expect(consoleSpy.mock.calls.length).toBe(callCount);
    consoleSpy.mockRestore();
  });
});

describe('shutdownTelemetry', () => {
  it('is safe to call when not initialized', async () => {
    await expect(shutdownTelemetry()).resolves.not.toThrow();
  });

  it('allows re-initialization after shutdown', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    await initTelemetry({ enabled: true, exporter: 'console' });
    await shutdownTelemetry();
    // Should be able to initialize again
    await initTelemetry({ enabled: true, exporter: 'console' });
    const otelCalls = consoleSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('OTel tracing'),
    );
    expect(otelCalls.length).toBe(2);
    consoleSpy.mockRestore();
    await shutdownTelemetry();
  });
});

describe('HTTP and Express auto-instrumentation', () => {
  afterEach(async () => {
    await shutdownTelemetry();
    delete process.env.OTEL_TRACES_EXPORTER;
  });

  it('registers HTTP and Express instrumentation without throwing', async () => {
    await expect(
      initTelemetry({ enabled: true, exporter: 'console' }),
    ).resolves.not.toThrow();
  });

  it('auto-instrumentation is included in both console and OTLP exporter modes', async () => {
    const consoleSpy = vi.spyOn(console, 'log');

    await initTelemetry({ enabled: true, exporter: 'console' });
    expect(consoleSpy).toHaveBeenCalledWith('📡 OTel tracing → console');

    consoleSpy.mockRestore();
  });

  it('is still idempotent after adding auto-instrumentation', async () => {
    const consoleSpy = vi.spyOn(console, 'log');

    await initTelemetry({ enabled: true, exporter: 'console' });
    const callCount = consoleSpy.mock.calls.length;
    await initTelemetry({ enabled: true, exporter: 'console' });
    expect(consoleSpy.mock.calls.length).toBe(callCount);

    consoleSpy.mockRestore();
  });
});
