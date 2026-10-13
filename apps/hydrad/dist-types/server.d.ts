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
export declare function startApiServer(options: ApiServerOptions): Promise<ApiServer>;
