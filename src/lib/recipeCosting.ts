export type RawCostLine = { raw_material_id: string; quantity: number; wastage_percent: number };
export type GroupCostLink = { unit_id: string; component_unit_id: string; quantity: number; wastage_percent: number };

/** Current recipe estimates only; never substitutes for historical FIFO. */
export function estimateGroupCosts(
  groupIds: string[],
  rawLines: (RawCostLine & { unit_id: string })[],
  links: GroupCostLink[],
  prices: Record<string, number>,
): Record<string, number | null> {
  const allowed = new Set(groupIds);
  const result: Record<string, number | null> = {};
  const visit = (id: string, path: Set<string>): number | null => {
    if (!allowed.has(id) || path.has(id)) return null;
    if (Object.prototype.hasOwnProperty.call(result, id)) return result[id];
    const next = new Set(path).add(id);
    const lines = rawLines.filter(row => row.unit_id === id && Number(row.quantity) > 0);
    const children = links.filter(row => row.unit_id === id && Number(row.quantity) > 0);
    if (!lines.length && !children.length) return result[id] = null;
    let total = 0;
    for (const line of lines) {
      const price = prices[line.raw_material_id];
      total += Number(line.quantity) * (1 + Number(line.wastage_percent || 0) / 100) * (price > 0 ? price : 0);
    }
    for (const child of children) {
      const cost = visit(child.component_unit_id, next);
      if (cost === null) return result[id] = null;
      total += Number(child.quantity) * (1 + Number(child.wastage_percent || 0) / 100) * cost;
    }
    return result[id] = total;
  };
  groupIds.forEach(id => visit(id, new Set()));
  return result;
}

export function estimateRecipeCost(
  lines: RawCostLine[],
  groups: { unit_id: string; quantity: number }[],
  prices: Record<string, number>,
  groupCosts: Record<string, number | null>,
  yieldQuantity: number,
) {
  let direct = 0;
  let linked = 0;
  let incomplete = !Number.isFinite(yieldQuantity) || yieldQuantity <= 0;
  for (const line of lines) {
    if (!line.raw_material_id || !(Number(line.quantity) > 0)) continue;
    const price = prices[line.raw_material_id];
    direct += Number(line.quantity) * (1 + Number(line.wastage_percent || 0) / 100) * (price > 0 ? price : 0);
  }
  for (const group of groups) {
    if (!group.unit_id || !(Number(group.quantity) > 0)) continue;
    const cost = groupCosts[group.unit_id];
    if (cost == null) incomplete = true;
    else linked += cost * Number(group.quantity);
  }
  // Product group links are quantities per sale, independent of recipe yield.
  const unitCost = Math.round((direct / (yieldQuantity > 0 ? yieldQuantity : 1) + linked) * 100) / 100;
  return { unitCost: incomplete ? null : unitCost, incomplete };
}
