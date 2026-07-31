import { WebSocket } from 'ws';
import type { GatewaySocket, GatewayTransport } from './openclaw.js';

/**
 * WebSocket transport for the OpenClaw Gateway.
 *
 * The `ws` dependency exists only here: the shell talks to the agent bridge over
 * plain HTTP (NDJSON streaming), so no WebSocket client ships to the browser.
 *
 * Like the provider that uses it, this has not been exercised against a live
 * gateway. The lifecycle it implements (timeout, error propagation, clean
 * close, backpressure-free queueing) is standard and unit tested with a fake.
 */
export class WsGatewayTransport implements GatewayTransport {
  async connect(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<GatewaySocket> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`Gateway URL must be ws:// or wss://, got ${parsed.protocol}`);
    }
    // Loopback by default: a gateway on another host is a deliberate act and
    // must use wss.
    if (
      parsed.protocol === 'ws:' &&
      parsed.hostname !== '127.0.0.1' &&
      parsed.hostname !== 'localhost'
    ) {
      throw new Error('An unencrypted gateway connection is only permitted to loopback.');
    }

    const socket = new WebSocket(url, { headers });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (cause: Error) => {
        clearTimeout(timer);
        reject(cause);
      });
    });

    return new WsGatewaySocket(socket);
  }
}

class WsGatewaySocket implements GatewaySocket {
  readonly #socket: WebSocket;

  constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  send(payload: string): void {
    this.#socket.send(payload);
  }

  async *messages(): AsyncIterable<string> {
    const queue: string[] = [];
    let notify: (() => void) | undefined;
    let closed = false;
    let failure: Error | undefined;

    const wake = (): void => {
      notify?.();
      notify = undefined;
    };

    this.#socket.on('message', (data: unknown) => {
      queue.push(String(data));
      wake();
    });
    this.#socket.on('close', () => {
      closed = true;
      wake();
    });
    this.#socket.on('error', (cause: Error) => {
      failure = cause;
      closed = true;
      wake();
    });

    for (;;) {
      while (queue.length > 0) {
        yield queue.shift() as string;
      }
      if (closed) {
        if (failure) throw failure;
        return;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  close(): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.close();
    else this.#socket.terminate();
  }
}
