export type ScenarioState =
  | 'draft'
  | 'armed'
  | 'incident'
  | 'grace'
  | 'released'
  | 'disarmed'
  | 'expired';

export interface Scenario {
  id: string;
  userId: string;
  name: string;
  description?: string;
  state: ScenarioState;
  activationAt?: string;
  expectedDurationSeconds?: number;
  mustRenewBy?: string;
  autoExpireAt?: string;
  checkinIntervalSeconds: number;
  gracePeriodSeconds: number;
  escalationPolicyId?: string;
  createdAt: string;
  armedAt?: string;
  disarmedAt?: string;
  releasedAt?: string;
  incidentOpenedAt?: string;
}

export interface ArmScenarioRequest {
  passwordProof: string;
  biometricReceipt: string;
  confirm: true;
}

export interface AbortScenarioRequest {
  passwordProof: string;
  biometricReceipt: string;
  abortCode: string;
}
