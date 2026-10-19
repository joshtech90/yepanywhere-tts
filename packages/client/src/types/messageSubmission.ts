import type {
  PatientQueueSource,
  UserMessageCompositionMetadata,
  UserMessageDeliveryIntent,
  UserMessageSpeechMetadata,
  TurnEffort,
} from "@yep-anywhere/shared";

export interface MessageSubmissionMetadata {
  turnEffort?: TurnEffort;
  deliveryIntent: UserMessageDeliveryIntent;
  patienceSeconds?: number;
  patientSource?: PatientQueueSource;
  compactAboveContextPercent?: number;
  steerNow?: boolean;
  composition: UserMessageCompositionMetadata;
  speech?: UserMessageSpeechMetadata;
}
