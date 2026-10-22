// Kiln: settings (OWNER: D). Every change applies live and is saved (main.js onChange).
// Sound on/off, music and effects volume, lite, reduce motion, reduce transparency, left-handed,
// thumb pad, fullscreen where supported, credits.

import { h } from '../dom.js';
import { panel, menu, switchRow, sliderRow, button } from './parts.js';

/**
 * data: { settings, fullscreen:{supported, on}, onChange(key, value), onCredits(), onBack() }
 */
export function settings(data, { el, nav }) {
  const s = data.settings;
  const set = (k) => (v) => data.onChange(k, v);
  const sliders = new Map();
  // Sound: all audio on or off, the same switch (and direction) as on the pause panel and the
  // HUD button; the two volumes below it
  const soundSwitch = switchRow(nav, 'Sound', !s.muted, (on) => data.onChange('muted', !on));
  const music = sliderRow(nav, 'Music', s.music, set('music'));
  sliders.set(nav.count - 1, music);
  const effects = sliderRow(nav, 'Effects', s.sfx, set('sfx'));
  sliders.set(nav.count - 1, effects);
  const rows = [
    soundSwitch,
    music.el,
    effects.el,
    switchRow(nav, 'Lite', !!s.lite, set('lite')),
    switchRow(nav, 'Reduce motion', !!s.reduceMotion, set('reduceMotion')),
    switchRow(nav, 'Reduce transparency', !!s.reduceTransparency, set('reduceTransparency')),
    switchRow(nav, 'Thumb pad', !!s.thumbPad, set('thumbPad')),
    switchRow(nav, 'Left-handed', !!s.leftHanded, set('leftHanded')),
    data.fullscreen && data.fullscreen.supported ? switchRow(nav, 'Fullscreen', !!data.fullscreen.on, set('fullscreen')) : null,
  ];
  const more = menu(nav, [{ label: 'Credits', act: () => data.onCredits() }]);
  const back = button(nav, 'Back', () => data.onBack());
  el.appendChild(h('div.stack', panel('Settings', h('div.scroll.menu', rows), more, h('div.foot', back))));
  return {
    initial: 0,
    onBack: data.onBack,
    /** Sound changed elsewhere (M, the HUD button): show it here. */
    setMuted(on) { soundSwitch.setOn(!on); },
    keys(e) {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return false;
      const sl = sliders.get(nav.index);
      if (!sl) return false;
      sl.step(e.code === 'ArrowLeft' ? -1 : 1);
      return true;
    },
  };
}
