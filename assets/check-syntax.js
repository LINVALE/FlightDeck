/*
 * Screen check, probe 1: the language FlightDeck's pages are written in.
 * A browser that cannot parse this file skips it and leaves the flag unset;
 * the rest of the check still runs. ES2018, like every other shipped asset.
 */
class Probe { constructor(x) { this.x = x; } }
const spread = { ...{ a: 1 }, b: 2 };
const arrow = async (value) => `${value}`;
window.fdCheckSyntax = new Probe(spread).x.b === 2 && typeof arrow === 'function';
