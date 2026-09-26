import { createContext, type ReactNode, useContext } from "react";
import { StoreProvider } from "~/state/hooks";
import type { EditorController } from "./controller";

const ControllerContext = createContext<EditorController | null>(null);

export function ControllerProvider({
	controller,
	children,
}: {
	controller: EditorController;
	children: ReactNode;
}) {
	return (
		<ControllerContext.Provider value={controller}>
			<StoreProvider store={controller.store}>{children}</StoreProvider>
		</ControllerContext.Provider>
	);
}

export function useController(): EditorController {
	const c = useContext(ControllerContext);
	if (!c) throw new Error("useController outside <ControllerProvider>");
	return c;
}
