/** Status item priorities. Within an alignment, higher sits closer to its edge. */
export const STATUS_PRIORITY = {
	// start
	frame: 300,
	selection: 200,
	issues: 100,
	dataset: 700,
	records: 600,
	selected: 500,
	dataIssues: 400,
	columns: 350,
	photos: 340,
	cellIssue: 330,
	// end
	zoom: 300,
	render: 200,
	record: 100,
	activity: 50,
} as const;
