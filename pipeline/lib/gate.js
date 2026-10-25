/**
 * Trava de licença: entidades cujas fontes são todas de redistribuição não conferida saem do snapshot.
 * Devolve { kept, blocked } com o conjunto de fontes barradas.
 */
export function applyLicenseGate(entities, observations, registry, policy) {
  const blocked = new Set(Object.values(registry)
    .filter(s => policy.licenseGate.block.includes(s.redistribution) && !s.licenseCheckedAt).map(s => s.id));
  return {
    blocked,
    kept: entities.filter(e => !(e.sources || []).every(s => blocked.has(s.sourceId))),
    observations: observations.filter(o => !blocked.has(o.sourceId)),
  };
}
