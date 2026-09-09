/**
 * The review interface.
 *
 * The confirmation gate is the whole argument of this product, and until now it
 * existed only as a function nobody could reach. This is where a person sees
 * what an expectation will actually be judging, and takes responsibility for it
 * by name.
 *
 * It runs locally, binds to 127.0.0.1 by default and has no accounts, because
 * it reads a store on your own disk and there is nothing here worth putting
 * behind a login that a filesystem permission would not do better.
 *
 * The browser never reimplements the gate. Every confirmation is decided by the
 * same `confirmAssertion` the CLI uses, and the live feedback on the attestation
 * box calls the real function over HTTP rather than a copy of its rules in
 * JavaScript. One source of truth, or the gate is theatre.
 */
export interface ServeOptions {
    readonly port?: number;
    readonly host?: string;
    readonly storeDir?: string;
}
export declare function serve(opts?: ServeOptions): Promise<{
    url: string;
    close: () => void;
}>;
