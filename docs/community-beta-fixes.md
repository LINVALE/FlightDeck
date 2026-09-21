# Community feedback fixes for the extension beta

Implemented 14 September 2026, against the working FlightDeck tree including the existing controller-pairing work. This is source implementation and offline validation, not a published beta image or hardware acceptance.

## Available controls

- **Main Wall cards:** a small faders icon beside the master volume opens individual player levels, step buttons and mute. Values update from Roon. Fixed-volume players are identified; incremental players have step controls. The panel closes when the group membership changes. Escape, Close and an outside press dismiss it.
- **Browse Back:** Face and phone restore the visible window, including its pixel inset; Face restores the selected row too. Earlier items remain reachable above the restored window. Puck retains its page and highlight while reloading fresh item keys after a Core-level Back. Phone rejects late responses after a new search or close and prevents overlapping More requests.
- **Volume:** absolute commands and puck dial selections preserve fractional device steps. Roon's lower hard limit is projected and enforced along with the existing upper and comfort limits. Group requests beyond safety still stop at comfort unless explicitly overridden. Screens receive limit, power and Radio-only changes even if the volume number stays unchanged.
- **Roon Radio:** on/off appears in the Face and phone queue, Puck queue, and Wall room options. This changes the current zone's `auto_radio` setting; it does not start playback or choose a seed track.
- **Standby:** Wall room options and Face/phone room menus offer standby only for an awake player with an advertised source-control key. The server checks the current key before sending one explicitly addressed standby command. The Wall settings menu also offers Standby all players: review the listed supported awake outputs, then confirm. Commands run sequentially for that reviewed set, skipping any output whose Core generation or advertised control changed. Unsupported players receive no command.

## Optional Face display settings

The face chooser now includes screen-local preferences. Defaults retain the previous presentation.

- Brightness: 100%, 75% or 50%, applied after 30 seconds without deliberate input.
- Gentle movement: optional small periodic movement of the displayed layout while unattended.
- Artist image: Fit or Fill. The relay preserves the complete source image so Fit can show it uncropped.
- Controls: auto-hide or keep visible.
- Blank when idle: Never (default), 15, 30 or 60 minutes. Faces stay visible while their room plays or loads; the full idle period starts when playback stops. Touch/key input starts a fresh interval. Playback automatically wakes an automatically blanked Face.
- Blank display now: blanks immediately until deliberately woken; ongoing playback does not undo this manual choice.

The existing idle clock is separate from black-screen blanking. Browser Wake Lock is held while the display is visible where supported, then released while blanked. This does not put the physical TV into hardware standby.

Dimming and movement are display options, not a guarantee against OLED image retention. Device power management and long-duration viewing still need hardware checks.

## Wall settings and automatic screensaver

The Wall cog includes dimming (Off, 75%, 50%), gentle movement, Roon Radio by room, Standby all players, and Blank this display now, alongside artwork, toolbar and puck settings.

Choose **Blank after inactivity: Never, 15, 30 or 60 minutes**. **Blank only when nothing is playing** defaults to Yes: all rooms, including hidden cards, must be quiet for the full selected interval. Choosing No allows the Wall to blank while music plays. Automatic blanking wakes when protected playback starts; manual Blank now stays blank until input. The first wake gesture is consumed so it cannot change playback or open controls underneath. Settings are saved locally, separately for Wall and Faces; a page reload starts a fresh inactivity interval. Screen blanking issues no player command and schedules no player standby countdown.

These Wall/screensaver additions are browser assets: refresh each open screen after applying them; no service restart is needed for this follow-up.

## Artwork handling

Artwork downloads stop when the byte budget is exceeded, instead of buffering the entire body before checking its size. An oversized declared Content-Length is rejected before body consumption. Empty, unsupported and failed artwork still resolve as unavailable artwork.

## Validation

- **413 tests passed across all 43 test files.** New behavioural coverage includes fractional steps, lower bounds, group comfort enforcement, source-key standby, Radio-only/limit-only snapshot changes, Browse window restoration, stale phone results, wake-lock ownership and bounded artwork streaming.
- **Chromium 63 floor lint passed for 36 browser assets.**
- **Chrome against an isolated mock Core passed:** Wall member controls including fixed/incremental devices and topology changes; Face/phone Back and earlier paging; Puck Back followed by fresh selection and its Radio toggle; display settings rendering, saved screensaver preferences, idle deadlines, playback protection and automatic wake, manual blanking and wake without click-through, and reviewed all-player standby. No browser runtime exceptions remained.
- The repeatable browser check is `node scripts/check-community-ui.mjs`. Set `FLIGHTDECK_TEST_CHROME` if Chrome is elsewhere. It starts only a mock server and its own temporary Chrome profile, then stops those processes; the terminal prints the temporary evidence directory. Controller discovery is intentionally absent in this fixture, so its 503 responses are expected.
- `npm run typecheck` could not run because this checkout has no `tsc` installation. No typecheck success is claimed.

## Activation and remaining acceptance

Restart the FlightDeck service after applying these source changes, then refresh each screen. If running a packaged Docker image, rebuild/update that image first; restarting an older image does not incorporate source edits. Neither Roon nor the audio endpoints need to be restarted for these changes. No running service, playback, queue or grouping was changed during implementation.

Still required on real devices: TV remote and physical puck controls; profile changes and playlist variants; sleep/wake; prolonged same-artwork and live-radio display; network loss/recovery; concurrent screens; volume behaviour on the actual amplifiers. The browser smoke test does not substitute for these.

Lyrics, signal path/sample-rate details, Roon saved bookmarks/Listen Later, full-library sorting/history, artist biographies/reviews and native apps are not added here. They require separate API feasibility or platform work. Live streams without a finite duration continue to show LIVE. The extension-first, beta-feedback-then-apps sequence remains unchanged.
