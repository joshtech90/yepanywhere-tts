export interface RendezTarget {
  harness: string;
  providerSessionId: string;
  yaSessionId?: string;
  liveOnly?: boolean;
}

export interface RendezSubscription {
  version: 1;
  route: string;
  project: string;
  target: RendezTarget;
  path: string;
}

export const MAX_ROUTES: number;

export function routeName(value: string): string;

export function atomicJson(path: string, value: unknown): Promise<void>;

export function subscribe(
  root: string,
  target: RendezTarget,
  options?: { route?: string; latest?: boolean; receivedAt?: number },
): Promise<RendezSubscription>;

export function settleLatest(root: string): Promise<void>;

export function publishLatest(
  root: string,
  route: string,
  receivedAt: number,
): Promise<void>;
