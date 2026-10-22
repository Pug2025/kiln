// Kiln: read the safe-area insets (notch, home indicator) in CSS px (OWNER: D).
// JS cannot read env() directly, so a hidden probe carries the insets as padding.

let probe = null;

/**
 * @param {{top:number, right:number, bottom:number, left:number}} out
 */
export function readSafeArea(out) {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  out.top = parseFloat(cs.paddingTop) || 0;
  out.right = parseFloat(cs.paddingRight) || 0;
  out.bottom = parseFloat(cs.paddingBottom) || 0;
  out.left = parseFloat(cs.paddingLeft) || 0;
  return out;
}
