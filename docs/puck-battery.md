# Physical Puck battery indicators

Physical Pucks report their battery sample and the durable output they are actually displaying. FlightDeck adds a compact battery badge for that room **only on the screen the Puck is paired with** (its card on that screen's Deck, its Face, Phone remote or browser Puck view). Other screens showing the same room stay clean, and an unpaired Puck shows no badge (Peter, 2026-09-21). Grouped rooms match any member output; each physical Puck retains its own identity. Browser battery state is never used.

A ~ prefix marks a voltage-based estimate. PWR means the supply reading is above the single-cell range and a battery percentage is unavailable; it does not claim active charging or full charge. A question mark means there is no valid battery reading. The tooltip identifies the Puck, explains the state and gives the measured supply voltage. Estimated levels at or below 20% use amber.

The room follows the device's displayedOutput acknowledgement rather than the paired browser's desired room. If the device moves rooms, loses its current room or stops reporting for five seconds, its old room badge disappears on the next refresh. Battery samples expire separately after 15 seconds. Legacy firmware remains compatible and adds no battery badge.

The hardware voltage curve still needs an unplugged reading on the target Puck: see puck-firmware/BATTERY.md. Activation requires the new firmware and a FlightDeck service reload for ControllerSessions, followed by a browser refresh. No Roon playback commands are required.

Checks: node test/controllers.test.ts; node test/puck-status.test.ts; node scripts/check-puck-battery.mjs; node scripts/floor-lint.ts. Browser checks use mock devices and an isolated server, including room movement, USB-range readings, Face/Phone/Puck routes and offline expiry.
