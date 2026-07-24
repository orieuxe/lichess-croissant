import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CADENCE_MAP_PATH = "cadence-map.json";

export type Category = "classique" | "non-classique";

export function loadCadenceMap(): Record<string, Category> {
  if (!existsSync(CADENCE_MAP_PATH)) return {};
  return JSON.parse(readFileSync(CADENCE_MAP_PATH, "utf8"));
}

export function saveCadenceMap(map: Record<string, Category>): void {
  writeFileSync(CADENCE_MAP_PATH, JSON.stringify(map, null, 2) + "\n");
}

export async function classifyCadence(
  cadenceText: string,
  askCategory: (cadenceText: string) => Promise<Category>,
): Promise<Category> {
  const map = loadCadenceMap();
  if (cadenceText in map) return map[cadenceText];
  const category = await askCategory(cadenceText);
  map[cadenceText] = category;
  saveCadenceMap(map);
  return category;
}
