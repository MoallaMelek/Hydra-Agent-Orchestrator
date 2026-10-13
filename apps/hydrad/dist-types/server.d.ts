import { type ServerResponse } from 'node:http';
import type { Engine } from '@hydra/engine';
export interface ApiServerOptions {
    engine: Engine;
    token: string;
    /** Directory with the built UI; omitted in API-only mode. */
    staticDir?: string;
    port?: number;
}
export interface ApiServer {
    port: number;
    url: string;
    close(): Promise<void>;
}
/** Serves a file from a built UI directory (SPA fallback to index.html), never escaping it. */
export declare function serveStaticFile(res: ServerResponse, staticDir: string, path: string, headers: Record<string, string>): void;
export declare function send(res: ServerResponse, status: number, body: unknown, type?: string): void;
export declare function startApiServer(options: ApiServerOptions): Promise<ApiServer>;
