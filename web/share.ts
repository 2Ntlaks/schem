// Share links: the circuit itself, deflate-compressed and base64url-encoded, after "#c=". Nothing
// is stored anywhere; the link is the circuit. Used by the playground and the docs page.

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function pack(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return encode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function unpack(s: string): Promise<string> {
  const stream = new Blob([decode(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
