// Keep app imports behind the guard: source, npm and Desktop all enter here.
import { checkServerRuntime } from "./runtimePreflight.js";

checkServerRuntime();
await import("./server-main.js");
