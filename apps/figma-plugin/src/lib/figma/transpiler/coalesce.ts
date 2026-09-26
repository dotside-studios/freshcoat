export type FlattenMarker = {
	nodeId: string;
	pos: { x: number; y: number };
	size: { width: number; height: number };
	reason: string;
	// Rotation in degrees, carried as a real transform onto the image element.
	// The bitmap's pixels are world-upright (Figma bakes the node's own rotation
	// into them), so this is whatever the element needs to STAY upright once the
	// painter has rotated the frame it sits in: 0 in an upright frame, the
	// inverse of the frame's world rotation in a rotated one.
	rotation: number;
};

// Flatten markers can never nest: the transpiler's walk stops descending the
// moment a node classifies as "flatten", so no marker is ever an ancestor of
// another. Two markers only relate as siblings, and each sibling is exported on
// its own — an icon flattened on top of a flattened panel is NOT in the panel's
// bitmap, even though its box sits entirely inside the panel's box.
//
// So geometry carries no information about redundancy here: dropping a marker
// because another marker's box contains it deletes a shape that nothing else
// draws, silently and without a warning. Identity is the only sound test, and
// with a walk that visits each node once this is a defensive no-op.
export function dedupeFlattenMarkers<T extends FlattenMarker>(
	markers: T[],
): T[] {
	const seen = new Set<string>();
	return markers.filter((m) => {
		if (seen.has(m.nodeId)) return false;
		seen.add(m.nodeId);
		return true;
	});
}
