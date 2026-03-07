/**
 * OTel SDK bootstrap for Wingman.
 *
 * Call `initTelemetry()` early in your startup sequence, before creating
 * WingmanClient or starting the server.
 *
 * Supports two exporters:
 *   - 'console'  → ConsoleSpanExporter (zero-setup, terminal output)
 *   - 'otlp'     → OTLPTraceExporter to HTTP endpoint (default: Jaeger at localhost:4318)
 *
 * Standard OTel environment variable overrides are honored by the SDK:
 *   OTEL_TRACES_EXPORTER                — 'console', 'otlp', or 'none'
 *   OTEL_EXPORTER_OTLP_ENDPOINT         — OTLP collector base URL (SDK appends /v1/traces)
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  — Trace-specific endpoint (takes priority)
 *   OTEL_SERVICE_NAME                    — service.name resource attribute
 *
 * Usage:
 *   import { initTelemetry } from '@wingman-chat/core';
 *   await initTelemetry({ enabled: true, exporter: 'console' });
 */

import type { WingmanTelemetryConfig } from './types.js';

let initialized = false;
let shutdownFn: (() => Promise<void>) | null = null;

/**
 * Initialize OpenTelemetry tracing. Call this once at startup,
 * before creating WingmanClient or starting the server.
 *
 * No-op if telemetry is disabled or already initialized.
 */
export async function initTelemetry(config: WingmanTelemetryConfig = {}): Promise<void> {
  if (!config.enabled) {
    return;
  }
  if (initialized) return;

  // Resolve exporter type: env var > config > default 'console'
  const rawExporterType =
    process.env.OTEL_TRACES_EXPORTER ??
    config.exporter ??
    'console';

  // Normalize: handle comma-separated lists and 'none' per OTel spec
  const exporterTokens = String(rawExporterType)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

  if (exporterTokens.length === 0 || exporterTokens.includes('none')) {
    console.log('📡 OTel tracing disabled (exporter=none)');
    initialized = true;
    return;
  }

  const exporterType: 'otlp' | 'console' =
    exporterTokens.includes('otlp') ? 'otlp' : 'console';

  // Resolve service name: env var > config > default 'wingman'
  const serviceName =
    process.env.OTEL_SERVICE_NAME ??
    config.serviceName ??
    'wingman';

  // Dynamic imports to avoid loading OTel when telemetry is off
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { SimpleSpanProcessor, BatchSpanProcessor, ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'gen_ai.system': 'github.copilot',
  });

  // Build span processors based on exporter type
  const processors = [];

  if (exporterType === 'otlp') {
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    // Only pass url when explicitly configured — let the SDK handle
    // OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_TRACES_ENDPOINT natively
    const exporterConfig = config.endpoint ? { url: config.endpoint } : {};
    const exporter = new OTLPTraceExporter(exporterConfig);

    // BatchSpanProcessor for production — queues spans and exports in batches
    processors.push(new BatchSpanProcessor(exporter));
    console.log(`📡 OTel tracing → OTLP${config.endpoint ? ` at ${config.endpoint}` : ' (default endpoint)'}`);
  } else {
    // SimpleSpanProcessor for console — immediate output for dev
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    console.log('📡 OTel tracing → console');
  }

  const provider = new NodeTracerProvider({ resource, spanProcessors: processors });
  provider.register();

  // Register HTTP and Express auto-instrumentation (patches http module and Express router)
  const { registerInstrumentations } = await import('@opentelemetry/instrumentation');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = await import('@opentelemetry/instrumentation-express');
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
    ],
    tracerProvider: provider,
  });

  initialized = true;

  shutdownFn = async () => {
    await provider.shutdown();
  };
}

/** Gracefully flush and shut down the OTel pipeline. */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdownFn) {
    await shutdownFn();
    shutdownFn = null;
  }
  initialized = false;
}
