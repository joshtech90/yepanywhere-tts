import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Runs a function in the async context captured when this module loaded, which
 * is outside every request. Long-lived async resources (native watches,
 * workers, intervals) capture the async context they are created in and keep
 * it, with every AsyncLocalStorage store value, for their whole lifetime; they
 * also run their callbacks in it. Many are created lazily during a request
 * (for example a directory watch when markdown augmentation checks a displayed
 * path), which pinned that request's data for the life of the resource. Create
 * them through this function instead.
 */
export const runOutsideRequestContext = AsyncLocalStorage.snapshot();
