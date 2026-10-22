// Kiln: pause (OWNER: D). Over the blurred live world. Resume only by a deliberate tap, click or
// Enter on Resume (PLAN §5); a tap anywhere else does nothing. Sound on/off sits here too.

import { h, pad2 } from '../dom.js';
import { panel, menu } from './parts.js';

export function pause(data, { el, nav }) {
  const sub = data.n ? h('div.sub', `${pad2(data.n)}  ${data.name || ''}`) : null;
  const list = menu(nav, [
    { label: 'Resume', act: () => data.onResume && data.onResume() },
    data.onRestart ? { label: 'Restart level', act: () => data.onRestart() } : null,
    data.onMute ? { toggle: true, label: 'Sound', on: !data.muted, change: () => data.onMute() } : null,
    data.onSettings ? { label: 'Settings', act: () => data.onSettings() } : null,
    data.onQuit ? { label: 'Levels', detail: 'Ends the run', act: () => data.onQuit() } : null,
  ]);
  el.appendChild(h('div.stack.narrow', panel('Paused', sub, list)));
  return {
    initial: 0,
    setMuted(on) { for (const s of list.switches) s.setOn(!on); },
  };
}
