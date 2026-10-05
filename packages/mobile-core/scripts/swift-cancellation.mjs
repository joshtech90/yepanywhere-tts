import { readFile, writeFile } from "node:fs/promises";

export async function enableSwiftCancellation(path) {
  let source = await readFile(path, "utf8");
  const adapter = await readFile(
    new URL("SwiftAsync.swift", import.meta.url),
    "utf8",
  );
  const begin = source.indexOf("fileprivate func uniffiRustCallAsync<F, T>(");
  const end = source.indexOf("// Callback handlers for an async calls.", begin);
  if (
    begin < 0 ||
    end < 0 ||
    !source.includes('fatalError("Cancellation not supported yet")')
  )
    throw new Error(
      "UniFFI Swift template changed; review the cancellation adapter",
    );
  source = source.slice(0, begin) + adapter + "\n" + source.slice(end);
  let calls = 0;
  source = source.replace(
    /(\s*)freeFunc: (ffi_ya_mobile_core_rust_future_free_(\w+)),/g,
    (_, space, free, kind) => {
      calls++;
      return `${space}cancelFunc: ffi_ya_mobile_core_rust_future_cancel_${kind},${space}freeFunc: ${free},`;
    },
  );
  if (!calls) throw new Error("No UniFFI async callsites to adapt");
  source = source.replace(
    'fatalError("Cancellation not supported yet")',
    "throw CancellationError()",
  );
  await writeFile(path, source);
}
