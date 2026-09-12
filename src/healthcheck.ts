// Docker HEALTHCHECK entrypoint (see the Dockerfile). The verdict lives in host-switch.ts, where it is tested.
import { healthVerdict, readHostSwitch } from './host-switch.ts';

const dataDir = process.env.FLIGHTDECK_DATA ?? '/data';
const port = Number(process.env.FLIGHTDECK_PORT ?? 8440);

process.exitCode = await healthVerdict(readHostSwitch(dataDir).on, async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(4000) });
  return response.ok;
});
