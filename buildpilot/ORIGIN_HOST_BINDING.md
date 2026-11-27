# Exact Origin/Host binding regression

The local BuildPilot API must reject loopback alias mismatches between the Origin authority and request Host. Test both directions (`localhost` versus `127.0.0.1`) while retaining exact same-origin loopback success.

This is defense in depth alongside bearer authentication, Fetch Metadata, and loopback binding. It does not authorize LAN exposure.
