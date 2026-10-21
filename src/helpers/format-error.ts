/**
 * Formats an error into a standardized error message
 * @param error Any error object to format
 * @returns A formatted error message as a string
 */

type QuickBooksFaultError = {
  Message?: string;
  Detail?: string;
  code?: string;
  element?: string;
};

function getQuickBooksFaultPayload(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as Record<string, unknown>;
  if (candidate.Fault) {
    return candidate;
  }
  const response = candidate.response;
  if (response && typeof response === "object") {
    const data = (response as Record<string, unknown>).data;
    if (data && typeof data === "object" && (data as Record<string, unknown>).Fault) {
      return data;
    }
  }
  return null;
}

function formatQuickBooksFaultError(entry: QuickBooksFaultError): string {
  const parts: string[] = [];
  if (entry.Message) {
    parts.push(entry.Message);
  }
  if (entry.Detail && entry.Detail !== entry.Message) {
    parts.push(entry.Detail);
  }
  if (entry.code) {
    parts.push(`code=${entry.code}`);
  }
  if (entry.element) {
    parts.push(`element=${entry.element}`);
  }
  return parts.join(" — ");
}

export function formatQuickBooksFaultMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const errors = (payload as { Fault?: { Error?: QuickBooksFaultError[] } }).Fault?.Error;
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  const formatted = errors.map(formatQuickBooksFaultError).filter(Boolean);
  if (formatted.length === 0) {
    return null;
  }
  return formatted.join("; ");
}

export function formatError(error: unknown): string {
  const faultMessage = formatQuickBooksFaultMessage(getQuickBooksFaultPayload(error));
  if (faultMessage) {
    return `Error: ${faultMessage}`;
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  } else if (typeof error === "string") {
    return `Error: ${error}`;
  } else {
    return `Unknown error: ${JSON.stringify(error)}`;
  }
}
