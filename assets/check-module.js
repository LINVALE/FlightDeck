/*
 * Screen check, probe 2: FlightDeck's pages load as ES modules. A browser
 * without module support never runs this file.
 */
export const probe = true;
window.fdCheckModule = probe;
