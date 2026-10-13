import type { IncomingMessage } from 'node:http';
/** Constant-time bearer token comparison. */
export declare function bearerMatches(header: string | undefined, token: string): boolean;
/**
 * DNS-rebinding defence: a malicious web page can make the browser send requests
 * to 127.0.0.1 under its own hostname. Only literal loopback hosts are accepted.
 */
export declare function hostAllowed(req: IncomingMessage, port: number): boolean;
/** Browsers always send Origin on WebSocket upgrades; only our own origin (or none, for native clients) is accepted. */
export declare function originAllowed(req: IncomingMessage, port: number, extraOrigins?: readonly string[]): boolean;
export declare const SECURITY_HEADERS: Record<string, string>;
