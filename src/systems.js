// Kiln — the sim systems, composed. main.js, the headless runner and tests build worlds with
// makeSystems() so everyone plays the same game. One fresh set per world (systems hold readers).
// OWNER after day one: A (signature changes are a shared-layer Request; see team/FILEMAP.md).

import { createPhysics } from './sim/physics.js';
import { createContent } from './content/content.js';
import { createEconomy } from './economy/economy.js';

/** @returns {import('./core/types.js').Systems} */
export function makeSystems() {
  return {
    physics: createPhysics(),
    content: createContent(),
    economy: createEconomy(),
  };
}
