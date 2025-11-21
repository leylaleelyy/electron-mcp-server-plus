import WebSocket from 'ws';
import { findElectronTarget } from './electron-connection';
import { logger } from './logger';

type TraceEvent = {
  name?: string;
  cat?: string;
  dur?: number;
  ts?: number;
};

export async function runDevToolsTrace(options?: {
  durationMs?: number;
  categories?: string[];
}): Promise<string> {
  const target = await findElectronTarget();
  const durationMs = options?.durationMs ?? 5000;
  const categories = options?.categories ?? [
    'devtools.timeline',
    'disabled-by-default-v8.cpu_profiler',
  ];

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const events: TraceEvent[] = [];
    let started = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Tracing.enable' }));
      ws.send(
        JSON.stringify({
          id: 2,
          method: 'Tracing.start',
          params: {
            categories: categories.join(','),
            transferMode: 'ReportEvents',
          },
        }),
      );
      started = true;
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({ id: 3, method: 'Tracing.end' }));
        } catch {}
      }, durationMs);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'Tracing.dataCollected' && msg.params?.value) {
          for (const e of msg.params.value) {
            events.push({ name: e.name, cat: e.cat, dur: e.dur, ts: e.ts });
          }
        }
        if (msg.method === 'Tracing.tracingComplete') {
          ws.close();
          const summary = summarizeTrace(events);
          resolve(JSON.stringify(summary, null, 2));
        }
      } catch (err) {
        logger.warn('trace parse error', err);
      }
    });

    ws.on('error', (err) => {
      if (started) reject(err);
    });
  });
}

function summarizeTrace(events: TraceEvent[]) {
  const byCat: Record<string, { count: number; totalDur: number }> = {};
  const long: Array<{ name: string; cat: string; dur: number }> = [];
  for (const e of events) {
    const cat = e.cat || 'unknown';
    const dur = e.dur || 0;
    if (!byCat[cat]) byCat[cat] = { count: 0, totalDur: 0 };
    byCat[cat].count++;
    byCat[cat].totalDur += dur;
    if (dur > 50000) long.push({ name: e.name || 'unknown', cat, dur });
  }
  long.sort((a, b) => b.dur - a.dur);
  const topLong = long.slice(0, 10);
  const cats = Object.keys(byCat)
    .map((k) => ({ cat: k, count: byCat[k].count, totalDur: byCat[k].totalDur }))
    .sort((a, b) => b.totalDur - a.totalDur)
    .slice(0, 10);
  return { totalEvents: events.length, topCategories: cats, topLongTasks: topLong };
}