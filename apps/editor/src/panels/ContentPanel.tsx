import { EMPTY } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import { FieldList } from "./content/FieldList";
import { RecordStepper } from "./content/RecordStepper";
import { EmptyPanel } from "./content/shared";

/** What fills the design: the bound records to try, then every field with its
 *  sample value and, expanded, its definition. */
export function ContentPanel() {
	const template = useEditor((s) => s.doc?.history.present ?? null);
	if (!template) return <EmptyPanel>{EMPTY.noTemplate}</EmptyPanel>;
	return (
		<div className="flex flex-col">
			<RecordStepper />
			<FieldList template={template} />
		</div>
	);
}
