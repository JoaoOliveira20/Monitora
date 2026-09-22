import assert from "node:assert/strict";
import { test } from "node:test";

import { findSample, findSamples, parsePrometheusText } from "../src/monitoring/prometheus-parser.js";

const SAMPLE_NODE_EXPORTER_OUTPUT = `
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 1000.55
node_cpu_seconds_total{cpu="0",mode="system"} 50.2
node_cpu_seconds_total{cpu="0",mode="user"} 100.7
node_cpu_seconds_total{cpu="1",mode="idle"} 990.1
node_cpu_seconds_total{cpu="1",mode="system"} 40.4
node_cpu_seconds_total{cpu="1",mode="user"} 95.3
# HELP node_memory_MemTotal_bytes Memory information field MemTotal_bytes.
# TYPE node_memory_MemTotal_bytes gauge
node_memory_MemTotal_bytes 1.6777216e+10
# HELP node_memory_MemAvailable_bytes Memory information field MemAvailable_bytes.
# TYPE node_memory_MemAvailable_bytes gauge
node_memory_MemAvailable_bytes 8.388608e+09
# HELP node_filesystem_size_bytes Filesystem size in bytes.
# TYPE node_filesystem_size_bytes gauge
node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 5e+10
node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/dev/shm"} 1e+09
# HELP node_filesystem_avail_bytes Filesystem space available to non-root users in bytes.
# TYPE node_filesystem_avail_bytes gauge
node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 2e+10
node_filesystem_avail_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/dev/shm"} 9e+08
`;

test("parsePrometheusText ignores comment and blank lines", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  assert.ok(samples.length > 0);
  assert.ok(samples.every((sample) => !sample.name.startsWith("#")));
});

test("parsePrometheusText parses a gauge without labels", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  const memTotal = findSample(samples, "node_memory_MemTotal_bytes");
  assert.equal(memTotal?.value, 16_777_216_000);
});

test("parsePrometheusText parses scientific notation values correctly", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  const available = findSample(samples, "node_memory_MemAvailable_bytes");
  assert.equal(available?.value, 8_388_608_000);
});

test("parsePrometheusText parses labels and allows filtering by them", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  const rootFilesystem = findSample(samples, "node_filesystem_size_bytes", { mountpoint: "/" });
  assert.equal(rootFilesystem?.value, 50_000_000_000);
  assert.equal(rootFilesystem?.labels.device, "/dev/sda1");

  const tmpfs = findSample(samples, "node_filesystem_size_bytes", { mountpoint: "/dev/shm" });
  assert.equal(tmpfs?.value, 1_000_000_000);
});

test("findSample returns undefined when no sample matches the label filter", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  const missing = findSample(samples, "node_filesystem_size_bytes", { mountpoint: "/does-not-exist" });
  assert.equal(missing, undefined);
});

test("findSamples returns every sample for a metric name across all label combinations", () => {
  const samples = parsePrometheusText(SAMPLE_NODE_EXPORTER_OUTPUT);

  const cpuSamples = findSamples(samples, "node_cpu_seconds_total");
  assert.equal(cpuSamples.length, 6);
});

test("parsePrometheusText ignores malformed or non-numeric lines instead of throwing", () => {
  const text = "not a valid metric line\nnode_memory_MemTotal_bytes not-a-number\nnode_memory_MemTotal_bytes 42";

  const samples = parsePrometheusText(text);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].value, 42);
});

test("parsePrometheusText handles an empty response without throwing", () => {
  const samples = parsePrometheusText("");
  assert.deepEqual(samples, []);
});
