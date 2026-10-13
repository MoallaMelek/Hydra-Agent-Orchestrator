import type { Engine } from '@hydra/engine';
import type { Device, DeviceScope } from '@hydra/protocol';
export interface RemoteHostOptions {
    engine: Engine;
    staticDir?: string;
    port: number;
    /** 0.0.0.0 for LAN access; 127.0.0.1 in tests. */
    bind: string;
    /** Host name or IP put into pairing links; defaults to the first LAN IPv4 address. */
    advertiseHost?: string;
}
export declare function lanAddress(): string;
/**
 * Remote control over an end-to-end encrypted channel (docs/v2/REMOTE.md).
 * Off until the user pairs a device. No cloud service is involved.
 */
export declare class RemoteHost {
    private readonly options;
    private server;
    private port;
    private readonly identity;
    private readonly pairings;
    private readonly sessions;
    /** Fixed-size handshake counter per IP: {window start, count}; never stores individual attempts. */
    private readonly attempts;
    /** In-flight commands per device+id, so concurrent duplicates share one execution. */
    private readonly inFlight;
    constructor(options: RemoteHostOptions);
    get running(): boolean;
    get engineFingerprint(): string;
    status(): {
        relayUrl: string | null;
        connected: boolean;
    };
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Creates a single-use pairing link (5 minutes). */
    pairStart(name: string, scopes: DeviceScope[]): Promise<{
        url: string;
        expiresAt: string;
        engineFingerprint: string;
    }>;
    revoke(deviceId: string): Promise<Device>;
    private sweepSessions;
    private allowAttempt;
    /** Test hook: number of tracked addresses (must stay bounded under flooding). */
    get trackedAddresses(): number;
    private accept;
    /**
     * First authenticated frame: registers a paired device or refreshes a known one.
     * State is re-read here, so a revocation during the handshake still wins.
     */
    private authenticate;
    private handle;
}
