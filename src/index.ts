export function resolveMonitorName(env: NodeJS.ProcessEnv): string {
  return env.MONITOR_NAME || "Monitora";
}

const environment = process.env.NODE_ENV ?? "development";
const monitorName = resolveMonitorName(process.env);

console.log(`${monitorName} starting in ${environment} mode`);
