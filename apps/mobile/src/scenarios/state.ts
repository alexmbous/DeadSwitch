import { create } from 'zustand';
import { api } from '@/api/client';

// Inlined from @deadswitch/shared to avoid workspace linking in Expo on pnpm.
export type ScenarioState_ =
  | 'draft' | 'armed' | 'incident_pending' | 'escalation_in_progress'
  | 'grace_period' | 'release_in_progress' | 'released' | 'aborted' | 'expired';
export interface Scenario {
  id: string;
  userId: string;
  name: string;
  description?: string;
  state: ScenarioState_;
  checkinIntervalSeconds: number;
  gracePeriodSeconds: number;
  createdAt: string;
  armedAt?: string;
  releasedAt?: string;
}

interface ScenarioState {
  scenarios: Scenario[];
  /** ISO strings keyed by scenario id. Server returns nextDueAt from check-in;
   *  the armedAt-anchored client estimate is correct for cadence but doesn't
   *  reflect a just-performed check-in, so we overlay server truth. */
  nextDueByScenario: Record<string, string>;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  create: (input: { name: string; checkinIntervalSeconds: number; gracePeriodSeconds: number }) => Promise<Scenario>;
  arm: (id: string, password: string) => Promise<{ abortCode: string }>;
  checkin: (id: string) => Promise<string | undefined>;
  disarm: (id: string, password: string) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
}

export const useScenarios = create<ScenarioState>((set, get) => ({
  scenarios: [],
  nextDueByScenario: {},
  loading: false,
  async load() {
    set({ loading: true, error: undefined });
    try {
      const scenarios = await api.get<Scenario[]>('/scenarios');
      set({ scenarios, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },
  async create(input) {
    const s = await api.post<Scenario>('/scenarios', input);
    set({ scenarios: [s, ...get().scenarios] });
    return s;
  },
  async arm(id, password) {
    const res = await api.post<{ scenario: Scenario; abortCode: string }>(
      `/scenarios/${id}/arm`,
      { password, biometricReceipt: 'bio' },
    );
    set({
      scenarios: get().scenarios.map((s) => (s.id === id ? res.scenario : s)),
    });
    return { abortCode: res.abortCode };
  },
  async checkin(id) {
    const res = await api.post<{ nextDueAt: string }>(`/scenarios/${id}/checkin`);
    if (res?.nextDueAt) {
      set({ nextDueByScenario: { ...get().nextDueByScenario, [id]: res.nextDueAt } });
    }
    await get().load();
    return res?.nextDueAt;
  },
  async disarm(id, password) {
    await api.post(`/scenarios/${id}/disarm`, { password, biometricReceipt: 'bio' });
    await get().load();
  },
  async deleteDraft(id) {
    await api.del(`/scenarios/${id}`);
    set({ scenarios: get().scenarios.filter((s) => s.id !== id) });
  },
}));
