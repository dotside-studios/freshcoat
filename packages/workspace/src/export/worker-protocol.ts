import type { Template } from "@freshcoat-js/coatfile";
import type { RenderOutput, RenderRequest } from "./item";

/** `template` is left out when it is the one the worker rendered last. */
export type WorkerRenderRequest = Omit<RenderRequest, "template"> & {
	template?: Template;
};

export type RenderWorkerRequest =
	| { type: "init"; fonts: [string, Uint8Array[]][] }
	/** the job is over: free what was kept across its items */
	| { type: "jobEnd" }
	| ({ type: "render"; id: number } & WorkerRenderRequest)
	| { type: "dispose" };

export type RenderWorkerReply =
	| { type: "ready"; ok: true; ms: number }
	| { type: "ready"; ok: false; error: string }
	| ({ type: "render"; id: number; ok: true } & RenderOutput)
	| { type: "render"; id: number; ok: false; error: string };
