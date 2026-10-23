// First-use help follows parsed rules, including abilities enabled by level defaults.
export function controlHints(rules, seen, touch) {
  const hints = [];
  if (!seen.launch) {
    hints.push(touch ? 'Drag to steer. Tap to launch.' : 'Move the mouse or use arrows to steer. Click or press Space to launch.');
    seen.launch = true;
  }
  // Reach players who already saw the old gesture-only Pull hint once.
  if (rules.pull && seen.pull !== 2) {
    hints.push(touch
      ? 'Pull: hold a second finger to bend balls toward your paddle; release to stop. Uses HEAT.'
      : 'Pull: hold a mouse button to bend balls toward your paddle; release to stop. Uses HEAT.');
    seen.pull = 2;
  }
  if (rules.heat && !rules.overloads && !seen.shield) {
    hints.push(touch ? 'Shield costs 100 HEAT and saves one miss.' : 'Q or E buys a Shield: 100 HEAT to save one miss.');
    seen.shield = true;
  }
  if (rules.overloads && !seen.overload) {
    hints.push(touch ? 'Tap the bottom button to fire your Overload. It empties HEAT.' : 'Q or E uses your Overload and empties HEAT.');
    seen.overload = true;
  }
  return hints;
}
