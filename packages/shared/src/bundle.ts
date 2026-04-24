export type RecipientKind = 'email' | 'sms' | 'secure_link' | 'social_handle';
export type AccessMethod = 'direct' | 'secure_link';
export type BundleVisibility = 'private' | 'public';
export type ReleaseStage = 'on_release' | 'on_incident_open';
export type Channel = 'email' | 'sms' | 'social';

export interface ReleaseBundle {
  id: string;
  scenarioId: string;
  title: string;
  releaseStage: ReleaseStage;
  visibility: BundleVisibility;
  createdAt: string;
}

export interface BundleRecipient {
  id: string;
  bundleId: string;
  recipientKind: RecipientKind;
  address: string;
  displayName?: string;
  accessMethod: AccessMethod;
  requireRecipientPin: boolean;
}

export interface PrivateVaultUploadRequest {
  bundleId: string;
  ciphertextBlobRef: string;
  wrappedDek: string;
  clientKeyId: string;
  nonce: string;
}

export interface ActionMessageIngestRequest {
  bundleId: string;
  recipientId?: string;
  channel: Channel;
  subject?: string;
  plaintext: string;
}
