/**
 * Switch sound profiles — the parameters that shape each switch type.
 * For v1 we synthesize the sounds in Web Audio from these parameters;
 * later we can ship pre-recorded WAVs and override the synth path.
 */

import type { SwitchProfile } from '@shared/types';

export const SWITCH_PROFILES: SwitchProfile[] = [
  {
    id: 'cherry-blue',
    name: 'Cherry MX Blue',
    clickFreq: 4200,
    clickQ: 12,
    clickGain: 0.85,
    bodyGain: 0.18,
    bodyDecayMs: 28,
    pitchJitterCents: 6,
    hasReleaseClick: true,
    accentColor: '#3aa8ff',
  },
  {
    id: 'cherry-brown',
    name: 'Cherry MX Brown',
    clickFreq: 2600,
    clickQ: 8,
    clickGain: 0.55,
    bodyGain: 0.32,
    bodyDecayMs: 42,
    pitchJitterCents: 8,
    hasReleaseClick: true,
    accentColor: '#a87532',
  },
  {
    id: 'topre',
    name: 'Topre',
    clickFreq: 950,
    clickQ: 3,
    clickGain: 0.18,
    bodyGain: 0.7,
    bodyDecayMs: 90,
    pitchJitterCents: 4,
    hasReleaseClick: false,
    accentColor: '#7affb1',
  },
  {
    id: 'buckling-spring',
    name: 'Buckling Spring',
    clickFreq: 3400,
    clickQ: 6,
    clickGain: 0.95,
    bodyGain: 0.5,
    bodyDecayMs: 70,
    pitchJitterCents: 10,
    hasReleaseClick: true,
    accentColor: '#ffb13a',
  },
];

export function getProfile(id: string): SwitchProfile {
  return SWITCH_PROFILES.find((p) => p.id === id) ?? SWITCH_PROFILES[0]!;
}
