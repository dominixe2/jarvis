/**
 * Bind the local JARVIS computer-control bridge to this machine only.
 *
 * LAN phone chat uses the separate authenticated Ollama relay. The bridge
 * exposes local tools and must never become reachable from the LAN by default.
 */
export function listenLoopback(server, port, callback) {
  return server.listen(port, "127.0.0.1", callback);
}
