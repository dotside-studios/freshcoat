import { ProgressBar } from "@freshcoat-js/ui/progress";
import { usePhotoImportProgress } from "./actions";

/** The running photo import's progress, over the bottom of the section. */
export function PhotoImportBar() {
	const progress = usePhotoImportProgress();
	if (!progress) return null;
	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-8 z-40 flex justify-center px-4"
			data-testid="photo-import-progress"
		>
			<div className="pointer-events-auto w-full max-w-sm rounded-[4px] border border-fc-border bg-fc-panel p-2 shadow-(--shadow-fc-popover)">
				<ProgressBar
					label={progress.label}
					value={progress.done}
					maxValue={Math.max(1, progress.total)}
					valueLabel={`${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`}
				/>
			</div>
		</div>
	);
}
