/** Accepted durable rows and the independent work repairing their freshness. */
export interface RetainedSessionCollectionState {
  catalogEpoch: string;
  catalogGeneration: number;
  complete: boolean;
  refreshing: boolean;
  refreshError?: string;
}

export interface SessionCatalogUpdatedEvent {
  type: "session-catalog-updated";
  catalog: RetainedSessionCollectionState;
  timestamp: string;
}
