# Music sources

Every file in this folder, where it came from, and its licence. Downloaded 2026-10-21.
Credit lines: `CREDITS.md` and the in-game Credits screen (`src/audio/credits.js`).

Processing (all files): decoded from the composer's MP3, leading and trailing silence trimmed,
encoded with macOS `afconvert` to AAC-LC in .m4a, 32 kHz stereo, about 72 kbps (Safari and
Chrome play it; no .ogg). Each stripped mix was aligned to its full mix to the sample and cut to
the same length, so the two loop in step for the HEAT crossfade.

| File | Track | Source URL | Page | Licence |
|---|---|---|---|---|
| `machina.m4a` | 'Machina' by Scott Buckley | https://www.scottbuckley.com.au/library/wp-content/uploads/2019/12/sb_machina.mp3 | https://www.scottbuckley.com.au/library/machina/ | CC BY 4.0 |
| `nightfall.m4a` | 'Nightfall' by Scott Buckley (full mix) | https://www.scottbuckley.com.au/library/wp-content/uploads/2019/05/sb_nightfall.mp3 | https://www.scottbuckley.com.au/library/nightfall/ | CC BY 4.0 |
| `nightfall-no-solo-strings.m4a` | 'Nightfall' by Scott Buckley (alternative mix "No Solo Strings") | https://www.scottbuckley.com.au/library/wp-content/uploads/2019/05/sb_nightfall_nosolostrings.mp3 | https://www.scottbuckley.com.au/library/nightfall/ | CC BY 4.0 |
| `resonance.m4a` | 'Resonance' by Scott Buckley (full mix) | https://www.scottbuckley.com.au/library/wp-content/uploads/2018/04/sb_resonance.mp3 | https://www.scottbuckley.com.au/library/resonance/ | CC BY 4.0 |
| `resonance-no-melody-in-backend.m4a` | 'Resonance' by Scott Buckley (alternative mix "No Melody in Backend") | https://www.scottbuckley.com.au/library/wp-content/uploads/2018/04/sb_resonance_altmix.mp3 | https://www.scottbuckley.com.au/library/resonance/ | CC BY 4.0 |
| `red.m4a` | 'Red' by Scott Buckley (full mix) | https://www.scottbuckley.com.au/library/wp-content/uploads/2018/10/sb_red.mp3 | https://www.scottbuckley.com.au/library/red/ | CC BY 4.0 |
| `red-no-vocals.m4a` | 'Red' by Scott Buckley (alternative mix "No Vocals") | https://www.scottbuckley.com.au/library/wp-content/uploads/2018/10/sb_red_altmix.mp3 | https://www.scottbuckley.com.au/library/red/ | CC BY 4.0 |
| `ambush.m4a` | 'Ambush' by Scott Buckley | https://www.scottbuckley.com.au/wp-content/audio/sb_ambush.mp3 | https://www.scottbuckley.com.au/library/ambush/ | CC BY 4.0 |
| `legacy.m4a` | 'Legacy' by Scott Buckley | https://www.scottbuckley.com.au/library/wp-content/uploads/2022/12/Legacy.mp3 | https://www.scottbuckley.com.au/library/legacy/ | CC BY 4.0 |
| `transmission.m4a` | "Transmission" from "Dark Sci-Fi Audio Pack" by SRG774 (run-over theme) | https://opengameart.org/sites/default/files/transmission_1.mp3 | https://opengameart.org/content/dark-sci-fi-audio-pack | CC0 |

Alignment applied: Nightfall "No Solo Strings" starts 861 samples (19.5 ms at 44.1 kHz) later than
the full mix; Resonance "No Melody in Backend" starts 9695 samples (219.8 ms) later and runs 31 s
past the full mix (the extra ending is cut); Red's two mixes line up as released.

Licence text, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
CC0: https://creativecommons.org/publicdomain/zero/1.0/
