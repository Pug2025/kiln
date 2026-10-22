// Kiln: line icons (OWNER: D). R17: 1.5 px stroke at 24 px, round caps, no fills, no glow,
// monochrome (currentColor).

const svg = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = Object.freeze({
  sound: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>'),
  pause: svg('<path d="M9 6v12"/><path d="M15 6v12"/>'),
});
