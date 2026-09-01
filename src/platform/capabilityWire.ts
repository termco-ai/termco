export type CapabilityWireError = {
  name: string;
  message: string;
  code?: string;
};

export type CapabilityWireResult =
  | { ok: true; value: unknown }
  | { ok: false; error: CapabilityWireError };

function serializedError(error: unknown): CapabilityWireError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      readonly name?: unknown;
      readonly message?: unknown;
      readonly code?: unknown;
    };
    if (typeof candidate.message !== "string") {
      return { name: "Error", message: String(error) };
    }
    return {
      name:
        typeof candidate.name === "string" && candidate.name.length > 0
          ? candidate.name
          : "Error",
      message: candidate.message,
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

/** Keep expected provider failures out of Electron's ipcMain rejection logger. */
export async function captureCapabilityResult(
  operation: () => unknown | Promise<unknown>,
): Promise<CapabilityWireResult> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: serializedError(error) };
  }
}

/** Restore normal Promise rejection semantics inside the renderer/preload. */
export function unwrapCapabilityResult(result: CapabilityWireResult): unknown {
  if (result.ok) return result.value;
  const error = new Error(result.error.message);
  error.name = result.error.name;
  if (result.error.code) {
    (error as Error & { code?: string }).code = result.error.code;
  }
  throw error;
}
