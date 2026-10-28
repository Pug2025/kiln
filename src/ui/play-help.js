// First-use help follows parsed rules, including abilities enabled by level defaults.
// The level card shows each line on its own line, so each phone line stays one line at 390 px.
export function controlHints(rules, seen, touch) {
  const hints = [];
  if (!seen.launch) {
    hints.push(touch ? 'Drag to steer. Tap to launch.' : 'Move the mouse or use arrows to steer. Click or press Space to launch.');
    seen.launch = true;
  }
  // Reach players who already saw the old gesture-only Pull hint once.
  if (rules.pull && seen.pull !== 2) {
    hints.push(touch ? 'Hold a second finger to Pull balls in.' : 'Hold a mouse button to Pull balls in.');
    seen.pull = 2;
  }
  if (rules.heat && !rules.overloads && !seen.shield) {
    hints.push(touch ? 'Shield (100 HEAT) saves a miss.' : 'Q or E: Shield (100 HEAT) saves a miss.');
    seen.shield = true;
  }
  if (rules.overloads && !seen.overload) {
    hints.push(touch ? 'The bottom button fires your Overload.' : 'Q or E uses your Overload and empties HEAT.');
    seen.overload = true;
  }
  return hints;
}
