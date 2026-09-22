export interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const METRIC_LINE_PATTERN = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/;
const LABEL_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseLabels(labelsBlock: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const inner = labelsBlock.slice(1, -1);

  for (const match of inner.matchAll(LABEL_PATTERN)) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }

  return labels;
}

export function parsePrometheusText(text: string): PrometheusSample[] {
  const samples: PrometheusSample[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = METRIC_LINE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const [, name, labelsBlock, rawValue] = match;
    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      continue;
    }

    samples.push({ name, labels: labelsBlock ? parseLabels(labelsBlock) : {}, value });
  }

  return samples;
}

export function findSample(
  samples: PrometheusSample[],
  name: string,
  labelFilter?: Record<string, string>
): PrometheusSample | undefined {
  return samples.find((sample) => {
    if (sample.name !== name) {
      return false;
    }
    if (!labelFilter) {
      return true;
    }
    return Object.entries(labelFilter).every(([key, value]) => sample.labels[key] === value);
  });
}

export function findSamples(samples: PrometheusSample[], name: string): PrometheusSample[] {
  return samples.filter((sample) => sample.name === name);
}
