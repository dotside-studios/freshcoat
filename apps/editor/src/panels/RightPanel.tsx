import { Tab, TabList, TabPanel, Tabs } from "@freshcoat-js/ui/tabs";
import { useController } from "~/app/context";
import { CONTENT } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import type { RightTab } from "~/state/store";
import { ContentPanel } from "./ContentPanel";
import { DesignPanel } from "./design/DesignPanel";
import { PrintPanel } from "./print/PrintPanel";

export function RightPanel({
	onTemplateSetup,
}: {
	onTemplateSetup?: () => void;
}) {
	const controller = useController();
	const tab = useEditor((s) => s.rightTab);
	return (
		<Tabs
			selectedKey={tab}
			onSelectionChange={(key) =>
				controller.dispatch({ type: "setRightTab", tab: key as RightTab })
			}
			className="min-h-0 flex-1"
		>
			<TabList aria-label="Inspector">
				<Tab id="design">{CONTENT.design}</Tab>
				<Tab id="content">{CONTENT.content}</Tab>
				<Tab id="print">{CONTENT.print}</Tab>
			</TabList>
			<TabPanel id="design" data-testid="design-panel">
				<DesignPanel />
			</TabPanel>
			<TabPanel id="content" data-testid="content-panel">
				<ContentPanel />
			</TabPanel>
			<TabPanel id="print" data-testid="print-panel">
				<PrintPanel onTemplateSetup={onTemplateSetup} />
			</TabPanel>
		</Tabs>
	);
}
