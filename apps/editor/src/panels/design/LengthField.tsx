import {
	type LengthUnit,
	pxToUnit,
	roundForUnit,
	unitPrecision,
	unitToPx,
} from "@freshcoat-js/coatfile";
import {
	NumberField,
	type NumberFieldProps,
} from "@freshcoat-js/ui/number-field";
import { parseLengthInput, UNIT_STEP, useLengthUnit } from "~/app/units";

type LengthFieldProps = Omit<
	NumberFieldProps,
	"unit" | "precision" | "parse" | "step" | "formatOptions"
> & {
	/** Leaves the unit suffix off, for fields too narrow to show it. */
	bare?: boolean;
};

/** A number field for a design px length, shown in the display unit. The
 *  stored px only changes when the shown value does. */
export function LengthField({
	value,
	onChange,
	min,
	max,
	bare = false,
	...rest
}: LengthFieldProps) {
	const { unit, dpi } = useLengthUnit();
	const toUnit = (px: number) => pxToUnit(px, unit, dpi);
	const shown = value === null ? null : roundForUnit(toUnit(value), unit);
	return (
		<NumberField
			{...rest}
			value={shown}
			unit={unit === "px" || bare ? undefined : unit}
			precision={unitPrecision(unit)}
			step={UNIT_STEP[unit]}
			min={min === undefined ? undefined : toUnit(min)}
			max={max === undefined ? undefined : toUnit(max)}
			parse={(text, current) => parseLengthInput(text, current, unit, dpi)}
			onChange={(v) => onChange(unit === "px" ? v : exactPx(v, unit, dpi))}
		/>
	);
}

function exactPx(v: number, unit: LengthUnit, dpi: number): number {
	const r = Math.round(unitToPx(v, unit, dpi) * 1e6) / 1e6;
	return r === 0 ? 0 : r;
}
