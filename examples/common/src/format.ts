export function hex(arrayBuffer: ArrayBuffer) {
  const bytes = Array.from(new Uint8Array(arrayBuffer));
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
