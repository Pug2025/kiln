// Kiln: the screen registry (OWNER: D). name → builder(data, kit) → {initial, onBack, keys, dispose}.

import { title } from './title.js';
import { map } from './map.js';
import { pick } from './pick.js';
import { pause } from './pause.js';
import { results } from './results.js';
import { forge } from './forge.js';
import { settings } from './settings.js';
import { credits } from './credits.js';
import { card } from './card.js';

export const SCREENS = {
  title,
  map,
  pick,
  gate: pick,
  pause,
  results,
  forge,
  settings,
  credits,
  card,
};
