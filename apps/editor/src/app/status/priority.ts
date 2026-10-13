/** Status item priorities. Within an alignment, higher sits closer to its edge. */
export const STATUS_PRIORITY = {
	// start
	frame: 300,
	selection: 200,
	issues: 100,
	// end
	zoom: 300,
	render: 200,
	record: 100,
} as const;
