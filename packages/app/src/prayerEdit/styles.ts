import {
  deleteKind,
  renameKind,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";

export function renameStyleKey(map: StyleMap, from: string, to: string): StyleMap {
  if (!(from in map) || from === to) return map;
  const { [from]: style, ...rest } = map;
  if (!style) return map;
  return { ...rest, [to]: style };
}

export function removeStyleKey(map: StyleMap, kind: string): StyleMap {
  if (!(kind in map)) return map;
  const { [kind]: _removed, ...rest } = map;
  return rest;
}

export type KindStyleMaps = {
  prayer: Prayer;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
};

/** Rename a kind on the prayer and remap both style maps. */
export function renameKindWithStyles(
  prayer: Prayer,
  appStyles: StyleMap,
  libraryStyles: StyleMap,
  from: string,
  to: string,
): KindStyleMaps {
  return {
    prayer: renameKind(prayer, from, to),
    appStyles: renameStyleKey(appStyles, from, to),
    libraryStyles: renameStyleKey(libraryStyles, from, to),
  };
}

/** Delete a kind on the prayer and drop style keys. */
export function deleteKindWithStyles(
  prayer: Prayer,
  appStyles: StyleMap,
  libraryStyles: StyleMap,
  kind: string,
): KindStyleMaps {
  return {
    prayer: deleteKind(prayer, kind),
    appStyles: removeStyleKey(appStyles, kind),
    libraryStyles: removeStyleKey(libraryStyles, kind),
  };
}
