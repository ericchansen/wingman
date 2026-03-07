/**
 * OTel SDK bootstrap — must be imported before any other modules.
 *
 * Sets up the OpenTelemetry trace pipeline based on WingmanTelemetryConfig.
 * Supports two exporters:
 *   - 'console'  → ConsoleSpanExporter (zero-setup, terminal output)
 *   - 'otlp'     → OTLPTraceExporter to HTTP endpoint (default: Jaeger at localhost:4318)
 *
 * Environment variable overrides (standard OTel env vars):
 *   OTEL_TRACES_EXPORTER       — 'console' or 'otlp' (overrides config)
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP collector URL (overrides config.endpoint)
 *   OTEL_SERVICE_NAME           — service.name resource attribute
 *
 * Usage:
 *   import { initTelemetry } from 'wingman';
 *   initTelemetry({ enabled: true, exporter: 'console' });
 *   // Then import everything else...
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
  if (initialized) return;
  if (!config.enabled) {
    initialized = true;
    return;
  }

  // Resolve exporter type: env var > config > default 'console'
  const exporterType =
    process.env.OTEL_TRACES_EXPORTER ??
    config.exporter ??
    'console';

  // Resolve service name: env var > config > default 'wingman'
  const serviceName =
    process.env.OTEL_SERVICE_NAME ??
    config.serviceName ??
    'wingman';

  // Dynamic imports to avoid loading OTel when telemetry is off
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { SimpleSpanProcessor, ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
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
    const endpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      config.endpoint ??
      'http://localhost:4318/v1/traces';

    processors.push(new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint })));
    console.log(`📡 OTel tracing → OTLP at ${endpoint}`);
  } else {
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    console.log('📡 OTel tracing → console');
  }

  const provider = new NodeTracerProvider({ resource, spanProcessors: processors });
  provider.register();
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
