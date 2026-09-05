"""Read the published catalog and inspect original/prepared image assets.

Downloads are byte-for-byte copies for inspection; this script never edits an
image, authenticates, writes the database or publishes the storefront.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import io
import json
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
import requests

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_HOSTS = {
    "fimgs.net", "acdn-us.mitiendanube.com",
    "lessence-furlani-vitrine.onrender.com",
}


def download(url):
    for _ in range(4):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError("Image host is not approved for this catalog audit")
        with requests.get(url, timeout=35, stream=True, allow_redirects=False) as response:
            if response.is_redirect:
                from urllib.parse import urljoin
                url = urljoin(url, response.headers["Location"])
                continue
            response.raise_for_status()
            parts, size = [], 0
            for part in response.iter_content(65536):
                size += len(part)
                if size > 12_000_000:
                    raise ValueError("Image exceeds 12 MB")
                parts.append(part)
            return b"".join(parts)
    raise ValueError("Too many redirects")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    sources = output / "sources"
    sources.mkdir(exist_ok=True)
    response = requests.get("https://lessence-furlani-api.onrender.com/api/vitrine", timeout=35)
    response.raise_for_status()
    catalog = response.json()
    legacy_path = ROOT / "tmp/white-background-image-report.json"
    legacy = {row["id"]: row for row in json.loads(legacy_path.read_text(encoding="utf-8-sig"))} if legacy_path.exists() else {}
    manifest_path = ROOT / "frontend/src/data/catalogImages.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    def inspect(item):
        row = {key: item.get(key) for key in ("id", "seq", "nome")}
        row["sourceUrl"] = url = str(item.get("imagemUrl") or "").strip()
        old = legacy.get(item["id"], {})
        prepared = ROOT / f"frontend/public/perfume-images/perfume-{int(item['seq']):03d}.avif"
        source_is_avif = urlparse(url).path.lower().endswith(".avif")
        # A current AVIF selection wins over historical conversions. Reusing a
        # prepared file requires the exact original URL and product id.
        reuse = not source_is_avif and old.get("sourceUrl") == url and prepared.is_file()
        current = manifest.get(item["id"], {})
        if current.get("source") == url:
            candidate = (ROOT / "frontend/public" / current["path"].lstrip("/")).resolve()
            if not candidate.is_relative_to((ROOT / "frontend/public/perfume-images").resolve()):
                raise ValueError("Prepared asset is outside perfume-images")
            if candidate.is_file():
                prepared, reuse = candidate, True
        try:
            if reuse:
                data = prepared.read_bytes()
                path = prepared
                row["selection"] = "prepared-exact-source"
            else:
                data = download(url)
                extension = Path(urlparse(url).path).suffix or ".bin"
                path = sources / f"{sha256(url.encode()).hexdigest()[:24]}{extension}"
                if path.exists() and path.read_bytes() != data:
                    raise ValueError("Source changed within the audit; use a new output directory")
                path.write_bytes(data)
                row["selection"] = "current-configured-image"
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                alpha = image.getchannel("A") if "A" in image.getbands() else None
                row.update(
                    format=image.format, width=image.width, height=image.height,
                    transparent=bool(alpha and alpha.getextrema()[0] < 255),
                    bytes=len(data), sha256=sha256(data).hexdigest(),
                    path=str(path.relative_to(ROOT)).replace("\\", "/"),
                )
                if alpha:
                    histogram = alpha.histogram()
                    row["transparentFraction"] = round(sum(histogram[:16]) / (image.width * image.height), 3)
        except Exception as error:
            row["error"] = str(error)
        return row

    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = []
        for row in executor.map(inspect, catalog["itens"]):
            rows.append(row)
            if len(rows) % 50 == 0:
                print(f"Inspected {len(rows)}/{len(catalog['itens'])}", flush=True)
    summary = {
        "total": len(rows), "errors": sum("error" in r for r in rows),
        "preparedReused": sum(r.get("selection") == "prepared-exact-source" for r in rows),
        "transparentAvif": sum(r.get("format") == "AVIF" and r.get("transparent", False) for r in rows),
        "needsReview": [{k: r.get(k) for k in ("seq", "nome", "format", "transparent", "error", "path")}
                        for r in rows if "error" in r or not r.get("transparent") or r.get("format") != "AVIF"],
    }
    (output / "report.json").write_text(json.dumps({"summary": summary, "images": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
