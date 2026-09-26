// Fonts the OS resolves without a web descriptor — safe to leave undeclared (but
// they CAN'T be declared, so their presence means we skip the fonts block).
export const SYSTEM_SAFE: ReadonlySet<string> = new Set([
	"Arial",
	"Arial Black",
	"Helvetica",
	"Helvetica Neue",
	"Times New Roman",
	"Times",
	"Courier New",
	"Courier",
	"Georgia",
	"Verdana",
	"Trebuchet MS",
	"Tahoma",
	"Impact",
	"Comic Sans MS",
	"Palatino",
	"Garamond",
	"Lucida Grande",
	"Segoe UI",
	"system-ui",
]);
