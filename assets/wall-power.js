/** Only explicitly advertised player power controls can be included. */
export function standbyTargets(snapshot) {
  var seen = {}, targets = [];
  if (!snapshot || !snapshot.core || snapshot.core.state !== 'paired') return targets;
  snapshot.zones.forEach(function (zone) {
    zone.outputs.forEach(function (output) {
      if (seen[output.id] || !output.power || !output.power.controlKey || output.power.asleep) return;
      seen[output.id] = true;
      targets.push({ output: output.id, controlKey: output.power.controlKey, name: output.name });
    });
  });
  return targets;
}

/** Execute just the reviewed set, sequentially; never add newly discovered players. */
export function standbyReviewed(targets, generation, read, send) {
  var result = { sent: 0, skipped: 0, failed: 0 };
  return targets.reduce(function (chain, target) {
    return chain.then(function () {
      var snapshot = read();
      var current = snapshot && snapshot.generation === generation ? standbyTargets(snapshot) : [];
      if (!current.some(function (item) { return item.output === target.output && item.controlKey === target.controlKey; })) { result.skipped++; return; }
      return send({ action: 'standby', output: target.output, controlKey: target.controlKey }).then(function (ok) {
        if (ok) result.sent++; else result.failed++;
      }).catch(function () { result.failed++; });
    });
  }, Promise.resolve()).then(function () { return result; });
}

