# /// script
# dependencies = ["rangehttpserver==1.4.0"]
# ///
"""Local static preview with HTTP byte ranges required by PMTiles."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from RangeHTTPServer import RangeRequestHandler

if __name__ == "__main__":
    site = Path(__file__).resolve().parents[1] / "site"
    print("Preview: http://127.0.0.1:8100", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8100), partial(RangeRequestHandler, directory=str(site))).serve_forever()
