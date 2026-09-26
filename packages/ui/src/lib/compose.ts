import { composeRenderProps } from "react-aria-components";
import { type ClassValue, cn } from "./cn";

export type ClassNameProp<T> =
	| string
	| ((values: T & { defaultClassName: string | undefined }) => string);

/** Merges kit classes under a RAC `className`, which may be a render function. */
export function composeTw<T>(
	className: ClassNameProp<T> | undefined,
	...base: ClassValue[]
): (values: T & { defaultClassName: string | undefined }) => string {
	return composeRenderProps(className, (cls) => cn(base, cls));
}
