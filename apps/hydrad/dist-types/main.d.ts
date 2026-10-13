export declare const VERSION = "2.0.0-alpha.0";
export declare function defaultDataDir(): string;
/**
 * Starts the engine and API. The API token comes from HYDRA_API_TOKEN (set by the
 * desktop shell) or is generated. A single JSON "ready" line is written to stdout
 * so a supervising process can discover the port.
 */
export declare function serve(argv?: string[]): Promise<void>;
