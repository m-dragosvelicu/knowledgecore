/**
 * Run manifest: records which layers ran, on what input, and when, so a bench
 * run is reproducible and auditable (CEO item 1: "a shared run manifest").
 * Not persisted automatically — callers (orchestrator scripts, not yet built)
 * decide where/when to write it; this module only builds the record.
 */
import type { LayerName, LayerReport, RunManifest, RunManifestLayerEntry } from "./types";

export function newManifest(runId: string): RunManifest {
  return { runId, startedAt: new Date().toISOString(), layers: [] };
}

export function recordLayerRun(manifest: RunManifest, report: LayerReport, ranOn: string): void {
  const entry: RunManifestLayerEntry = {
    layer: report.layer,
    ran: true,
    itemCount: report.items.length,
    ranOn,
    totalCostUsd: report.totalCostUsd,
    totalLatencyMs: report.totalLatencyMs,
  };
  manifest.layers.push(entry);
}

export function recordLayerSkipped(manifest: RunManifest, layer: LayerName, reason: string): void {
  manifest.layers.push({
    layer,
    ran: false,
    itemCount: 0,
    ranOn: reason,
    totalCostUsd: 0,
    totalLatencyMs: 0,
  });
}

export function finalizeManifest(manifest: RunManifest, notes?: string): RunManifest {
  manifest.finishedAt = new Date().toISOString();
  if (notes) manifest.notes = notes;
  return manifest;
}
