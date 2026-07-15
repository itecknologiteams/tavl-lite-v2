import { describe, it, expect, beforeEach } from 'vitest';
import eslConnection from './esl';

// _api is private; reach it via `as any`. TS `private` is compile-time only.
const esl = eslConnection as any;

describe('EslConnection._api serialization', () => {
  beforeEach(() => {
    esl.isConnected = true;
  });

  it('runs concurrent _api calls one at a time and returns each its OWN response', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    // Fake modesl conn. If two api() callbacks were ever in flight at once,
    // modesl would cross their responses — the bug we are fixing. We assert
    // the queue prevents overlap entirely.
    esl.conn = {
      api(cmd: string, cb: (res: any) => void) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          order.push(cmd);
          cb({ getBody: () => `result:${cmd}` });
        }, 5);
      },
    };

    const [a, b, c] = await Promise.all([
      esl._api('cmd-A'),
      esl._api('cmd-B'),
      esl._api('cmd-C'),
    ]);

    expect(maxInFlight).toBe(1);            // never overlapped on the socket
    expect(a).toBe('result:cmd-A');         // each caller got its own reply
    expect(b).toBe('result:cmd-B');
    expect(c).toBe('result:cmd-C');
    expect(order).toEqual(['cmd-A', 'cmd-B', 'cmd-C']); // FIFO order preserved
  });

  it('a rejected call does not stall the queue', async () => {
    esl.conn = {
      api(cmd: string, cb: (res: any) => void) {
        setTimeout(() => cb({ getBody: () => (cmd === 'bad' ? '-ERR boom' : `ok:${cmd}`) }), 1);
      },
    };

    const results = await Promise.allSettled([
      esl._api('bad'),
      esl._api('good'),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect((results[1] as PromiseFulfilledResult<string>).value).toBe('ok:good');
  });
});
