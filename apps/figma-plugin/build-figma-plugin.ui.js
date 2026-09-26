// The Freshcoat address this build ships with, as the default for the
// Settings field. FRESHCOAT_URL overrides it when building.
export default function (buildOptions) {
	return {
		...buildOptions,
		define: {
			...buildOptions.define,
			FRESHCOAT_URL: JSON.stringify(process.env.FRESHCOAT_URL ?? "https://freshcoat.dotsidestudios.com"),
		},
	};
}
