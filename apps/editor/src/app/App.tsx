import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EditorController } from "./controller";
import { createAppRouter } from "./router";

export function App() {
	const [controller] = useState(() => new EditorController());
	const [router] = useState(() => createAppRouter({ controller }));
	useEffect(() => () => controller.dispose(), [controller]);
	return <RouterProvider router={router} />;
}
