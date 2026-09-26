import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { EditorController } from "./controller";
import { createAppRouter } from "./router";

export function App() {
	const [router] = useState(() =>
		createAppRouter({ controller: new EditorController() }),
	);
	return <RouterProvider router={router} />;
}
