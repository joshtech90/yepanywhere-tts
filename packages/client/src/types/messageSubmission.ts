import type {
  UserMessageCompositionMetadata,
  UserMessageDeliveryIntent,
  UserMessageSpeechMetadata,
  TurnEffort,
} from "@yep-anywhere/shared";

export interface MessageSubmissionMetadata {
  turnEffort?: TurnEffort;
  deliveryIntent: UserMessageDeliveryIntent;
  patienceSeconds?: number;
  steerNow?: boolean;
  composition: UserMessageCompositionMetadata;
  speech?: UserMessageSpeechMetadata;
}
