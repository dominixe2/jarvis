/**
 * Bind the local JARVIS bridge to the current machine only.
 *
 * LAN access must use a separately authenticated pairing flow; the bridge
 * exposes local tools and credential-backed speech endpoints.
 */
export function listenLoopback(server, port, callback) {
  return server.listen(port, "127.0.0.1", callback);
}
