import WebSocket from 'ws';
import { findElectronTarget } from './electron-connection';

type Req = {
  id: string;
  url?: string;
  method?: string;
  startTs?: number;
  endTs?: number;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  encodedDataLength?: number;
};

export async function captureNetworkSnapshot(options?: {
  durationMs?: number;
  idleMs?: number;
  maxRequests?: number;
  includeFailures?: boolean;
}): Promise<string> {
  const target = await findElectronTarget();
  const durationMs = options?.durationMs ?? 5000;
  const idleMs = options?.idleMs ?? 800;
  const maxRequests = options?.maxRequests ?? 500;
  const includeFailures = options?.includeFailures ?? true;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const map: Record<string, Req> = {};
    let lastActivity = Date.now();
    let timer: NodeJS.Timeout | undefined;

    function done() {
      try {
        ws.close();
      } catch {}
      const list = Object.values(map);
      const withDur = list.map((r) => ({
        id: r.id,
        url: r.url,
        method: r.method,
        status: r.status,
        mimeType: r.mimeType,
        encodedDataLength: r.encodedDataLength,
        durationMs: r.endTs && r.startTs ? (r.endTs - r.startTs) / 1000 : undefined,
        failed: r.failed,
      }));
      const slow = withDur
        .filter((r) => (r.durationMs || 0) > 300)
        .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
        .slice(0, 10);
      const errors = withDur.filter((r) => includeFailures && (r.failed || (r.status || 0) >= 400)).slice(0, 20);
      const summary = {
        total: withDur.length,
        slowTop10: slow,
        errors,
      };
      resolve(JSON.stringify(summary, null, 2));
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
      timer = setTimeout(done, durationMs);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.method) {
          case 'Network.requestWillBeSent': {
            const p = msg.params;
            const id = p.requestId;
            map[id] = map[id] || { id };
            map[id].url = p.request?.url;
            map[id].method = p.request?.method;
            map[id].startTs = p.timestamp * 1000;
            lastActivity = Date.now();
            break;
          }
          case 'Network.responseReceived': {
            const p = msg.params;
            const id = p.requestId;
            map[id] = map[id] || { id };
            map[id].status = p.response?.status;
            map[id].mimeType = p.response?.mimeType;
            break;
          }
          case 'Network.loadingFinished': {
            const p = msg.params;
            const id = p.requestId;
            map[id] = map[id] || { id };
            map[id].endTs = p.timestamp * 1000;
            map[id].encodedDataLength = p.encodedDataLength;
            lastActivity = Date.now();
            break;
          }
          case 'Network.loadingFailed': {
            const p = msg.params;
            const id = p.requestId;
            map[id] = map[id] || { id };
            map[id].failed = true;
            map[id].endTs = p.timestamp * 1000;
            lastActivity = Date.now();
            break;
          }
        }
        if (Object.keys(map).length > maxRequests) done();
        if (Date.now() - lastActivity > idleMs) done();
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}