import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...props}
		>
			{children}
		</svg>
	);
}

export function ChevronDownIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4.5 6.25 8 9.75l3.5-3.5" />
		</Icon>
	);
}

export function ChevronRightIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M6.25 4.5 9.75 8l-3.5 3.5" />
		</Icon>
	);
}

export function CheckIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m3.75 8.25 2.75 2.75 5.75-6" />
		</Icon>
	);
}

export function CloseIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m4.5 4.5 7 7m0-7-7 7" />
		</Icon>
	);
}

export function DashIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 8h8" />
		</Icon>
	);
}

export function GripIcon(props: IconProps) {
	return (
		<Icon {...props} fill="currentColor" stroke="none">
			<circle cx="6" cy="4" r="1" />
			<circle cx="10" cy="4" r="1" />
			<circle cx="6" cy="8" r="1" />
			<circle cx="10" cy="8" r="1" />
			<circle cx="6" cy="12" r="1" />
			<circle cx="10" cy="12" r="1" />
		</Icon>
	);
}
