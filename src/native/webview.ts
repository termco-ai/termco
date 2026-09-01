/**
 * Only `getCurrentWebview().onDragDropEvent(...)` is used (terminal + explorer
 * file drop). The main process forwards native file-drop payloads shaped as
 * `{ type: "enter"|"over"|"drop"|"leave", paths, position }`.
 */
import { bridge } from "./bridge";

type UnlistenFn = () => void;

export interface DragDropEvent {
  event: string;
  payload:
    | { type: "enter"; paths: string[]; position: { x: number; y: number } }
    | { type: "over"; position: { x: number; y: number } }
    | { type: "drop"; paths: string[]; position: { x: number; y: number } }
    | { type: "leave" };
}

export class Webview {
  constructor(public readonly label: string) {}

  async onDragDropEvent(
    handler: (event: DragDropEvent) => void,
  ): Promise<UnlistenFn> {
    return bridge().onWindowEvent("drag-drop", (payload) => {
      handler({
        event: "drag-drop",
        payload: payload as DragDropEvent["payload"],
      });
    });
  }
}

export function getCurrentWebview(): Webview {
  return new Webview("main");
}
