"""Stage reviewed AVIF files byte-for-byte and generate the source-bound map."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
# Existing Fragrantica cutouts, checked against the original bottles on 04/09.
REVIEWED_REFERENCES = {
    398: (16657, "https://www.fragrantica.com/perfume/Versace/Eros-16657.html"),
    163: (13201, "https://www.fragrantica.com/perfume/Gucci/Gucci-Guilty-Intense-13201.html"),
    306: (14319, "https://www.fragrantica.com/perfume/Narciso-Rodriguez/Narciso-Rodriguez-for-Her-Eau-de-Parfum-14319.html"),
    182: (69224, "https://www.fragrantica.com/perfume/Initio-Parfums-Prives/Oud-for-Happiness-69224.html"),
    294: (114008, "https://www.fragrantica.com/perfume/Montblanc/Signature-Elixir-114008.html"),
    129: (2056, "https://www.fragrantica.com/perfume/Dolce-Gabbana/The-One-for-Men-2056.html"),
    388: (101384, "https://www.fragrantica.com/perfume/Valentino/Born-in-Roma-Extradose-Donna-101384.html"),
    389: (84444, "https://www.fragrantica.com/perfume/Valentino/Valentino-Donna-Born-In-Roma-Pink-PP-84444.html"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    report_path = args.report.resolve()
    rows = json.loads(report_path.read_text(encoding="utf-8"))["images"]
    manifest_path = ROOT / "frontend/src/data/catalogImages.json"
    baseline = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest, provenance, staged = {}, [], {}
    for row in sorted(rows, key=lambda r: r["seq"]):
        if row.get("error"):
            raise ValueError(f"Unresolved image: {row['seq']}")
        path = ROOT / row["path"]
        reference_url = row["sourceUrl"]
        needs_review = row.get("format") != "AVIF" or not row.get("transparent")
        if needs_review and row["seq"] in REVIEWED_REFERENCES:
            if baseline.get(row["id"], {}).get("source") != row["sourceUrl"]:
                raise ValueError(f"Changed source requires a new visual review: {row['seq']}")
            ref, reference_url = REVIEWED_REFERENCES[row["seq"]]
            path = report_path.parent / f"sources/candidate-{row['seq']}.avif"
        data = path.read_bytes()
        digest = sha256(data).hexdigest()
        if not needs_review and digest != row["sha256"]:
            raise ValueError(f"Asset changed since inspection: {row['seq']}")
        with Image.open(path) as image:
            image.load()
            if image.format != "AVIF" or "A" not in image.getbands() or image.getchannel("A").getextrema()[0] == 255:
                raise ValueError(f"A transparent AVIF is required: {row['seq']}")
        asset_path = f"/perfume-images/catalog-{digest[:24]}.avif"
        if row["id"] in manifest:
            raise ValueError("Duplicate product id")
        manifest[row["id"]] = {"source": row["sourceUrl"], "path": asset_path}
        staged[asset_path] = path
        provenance.append({
            "id": row["id"], "seq": row["seq"], "nome": row["nome"],
            "configuredSource": row["sourceUrl"], "reference": reference_url,
            "asset": asset_path, "sha256": digest, "bytes": len(data),
        })
    if args.write:
        for asset, source in staged.items():
            target = ROOT / "frontend/public" / asset.lstrip("/")
            if target.exists() and target.read_bytes() != source.read_bytes():
                raise ValueError("Refusing to overwrite a content-addressed asset")
            if not target.exists():
                shutil.copyfile(source, target)
        dest = ROOT / "frontend/src/data/catalogImages.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (report_path.parent / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"perfumes": len(manifest), "uniqueAssets": len(staged), "bytes": sum(p.stat().st_size for p in staged.values()), "written": args.write}))


if __name__ == "__main__":
    main()
