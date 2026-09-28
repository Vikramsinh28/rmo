"""Render a self-contained HTML test report from run_video_report output.

Usage:
    python -m evaluation.build_html_report report.json --images DIR --notes notes.json --out report.html
"""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path

STATUS_COLORS = {
    "NO_PERSON": "#e5e7eb",
    "INSUFFICIENT_EVIDENCE": "#9ca3af",
    "NORMAL": "#22c55e",
    "MONITORING": "#eab308",
    "ELEVATED_INDICATORS": "#f97316",
    "HIGH_INDICATORS": "#dc2626",
}
STATUS_LABELS = {
    "NO_PERSON": "No person",
    "INSUFFICIENT_EVIDENCE": "Insufficient evidence",
    "NORMAL": "Normal",
    "MONITORING": "Monitoring",
    "ELEVATED_INDICATORS": "Elevated",
    "HIGH_INDICATORS": "High",
}
ALERT_STATUSES = {"ELEVATED_INDICATORS", "HIGH_INDICATORS"}

CSS = """
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:1040px;
margin:32px auto;padding:0 24px;line-height:1.5;font-size:14px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px;border-bottom:2px solid #e5e7eb;
padding-bottom:4px}h3{font-size:15px;margin:20px 0 6px}
.meta{color:#6b7280;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.kpi{border:1px solid #e5e7eb;border-radius:8px;padding:12px}
.kpi b{display:block;font-size:24px}.kpi span{color:#6b7280;font-size:12px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}
th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f9fafb}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.ok{color:#15803d}.bad{color:#b91c1c}.warn{color:#a16207}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:12px 0;page-break-inside:avoid}
.card img{max-width:100%;max-height:260px;border-radius:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.legend span{display:inline-block;margin-right:12px;font-size:12px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px}
ul{margin:4px 0 8px 20px;padding:0}
@media print{body{margin:0}h2{page-break-after:avoid}}
"""


def esc(value: object) -> str:
    return html.escape(str(value))


def pill(status: str) -> str:
    color = STATUS_COLORS.get(status, "#e5e7eb")
    text = "#111827" if status in {"NO_PERSON", "MONITORING"} else "#fff"
    return (
        f'<span class="pill" style="background:{color};color:{text}">'
        f"{esc(STATUS_LABELS.get(status, status))}</span>"
    )


def timeline_svg(timeline: list[dict], width: int = 960, height: int = 90) -> str:
    if not timeline:
        return ""
    n = len(timeline)
    step = width / n
    rects = []
    points = []
    for i, row in enumerate(timeline):
        color = STATUS_COLORS.get(row.get("status", "NO_PERSON"), "#e5e7eb")
        rects.append(
            f'<rect x="{i * step:.2f}" y="{height - 14}" width="{step + 0.5:.2f}" '
            f'height="14" fill="{color}"/>'
        )
        score = float(row.get("score") or 0.0)
        points.append(f"{i * step + step / 2:.1f},{(height - 18) * (1 - score):.1f}")
    guides = "".join(
        f'<line x1="0" x2="{width}" y1="{(height - 18) * (1 - v):.1f}" '
        f'y2="{(height - 18) * (1 - v):.1f}" stroke="#d1d5db" stroke-dasharray="4 3"/>'
        f'<text x="2" y="{(height - 18) * (1 - v) - 2:.1f}" font-size="9" fill="#6b7280">{v}</text>'
        for v in (0.5, 0.7)
    )
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" preserveAspectRatio="none">'
        f"{guides}{''.join(rects)}"
        f'<polyline fill="none" stroke="#1d4ed8" stroke-width="1.5" points="{" ".join(points)}"/>'
        f'<text x="{width - 2}" y="10" font-size="9" text-anchor="end" fill="#6b7280">'
        f"{n}s</text></svg>"
    )


def image_tag(path: Path) -> str:
    if not path.exists():
        return ""
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f'<img src="data:image/jpeg;base64,{data}" alt="{esc(path.stem)}"/>'


def verdict(video: dict) -> tuple[str, str]:
    alerted = video.get("peakStatus") in ALERT_STATUSES
    if video.get("expected") == "alert":
        return ("Detected", "ok") if alerted else ("Missed", "bad")
    return ("False alert", "bad") if alerted else ("Correct (no alert)", "ok")


def render(videos: list[dict], images: Path, notes: dict) -> str:
    positives = [v for v in videos if v.get("expected") == "alert"]
    negatives = [v for v in videos if v.get("expected") != "alert"]
    detected = sum(1 for v in positives if v.get("peakStatus") in ALERT_STATUSES)
    false_alerts = sum(1 for v in negatives if v.get("peakStatus") in ALERT_STATUSES)
    seconds = sum(v.get("secondsAnalysed", 0) for v in videos)
    frames = sum(v.get("samples", 0) for v in videos)
    ms = [v["msPerFrame"] for v in videos if v.get("msPerFrame")]

    parts = [f"<!doctype html><html><head><meta charset='utf-8'><title>{esc(notes['title'])}</title>"
             f"<style>{CSS}</style></head><body>"]
    parts.append(f"<h1>{esc(notes['title'])}</h1><div class='meta'>{esc(notes['subtitle'])}</div>")

    parts.append("<div class='kpis'>")
    for value, label in (
        (f"{len(videos)}", "video clips tested"),
        (f"{seconds / 60:.1f} min", f"footage analysed ({frames:,} frames)"),
        (f"{detected} / {len(positives)}", "impairment clips raised an alert"),
        (f"{false_alerts} / {len(negatives)}", "false alerts on normal clips"),
    ):
        parts.append(f"<div class='kpi'><b>{esc(value)}</b><span>{esc(label)}</span></div>")
    parts.append("</div>")

    for section in notes["sections_before"]:
        parts.append(section)

    parts.append("<h2>Results per clip</h2>")
    parts.append(
        "<table><tr><th>Clip</th><th>Type</th><th>Length</th><th>Expected</th>"
        "<th>Highest status reached</th><th>First alert</th><th>Result</th></tr>"
    )
    for v in videos:
        text, cls = verdict(v)
        first = f"{v['firstAlertSeconds']:.0f}s" if v.get("firstAlertSeconds") is not None else "—"
        expected = "Alert" if v.get("expected") == "alert" else "No alert"
        parts.append(
            f"<tr><td>{esc(v['title'])}</td><td>{esc(v['label'])}</td>"
            f"<td>{v.get('secondsAnalysed', 0):.0f}s</td><td>{expected}</td>"
            f"<td>{pill(v.get('peakStatus', 'NO_PERSON'))}</td><td>{first}</td>"
            f"<td class='{cls}'><b>{esc(text)}</b></td></tr>"
        )
    parts.append("</table>")

    legend = "".join(
        f"<span><i style='background:{c}'></i>{esc(STATUS_LABELS[s])}</span>"
        for s, c in STATUS_COLORS.items()
    )
    parts.append("<h2>Clip details</h2>")
    parts.append(
        "<p>Each timeline shows one row per second: the coloured strip is the status the "
        "system displayed, the blue line is the combined risk score (0–1). Dashed lines mark "
        f"the Elevated (0.5) and High (0.7) score thresholds.</p><div class='legend'>{legend}</div>"
    )
    for v in videos:
        text, cls = verdict(v)
        status_time = ", ".join(
            f"{STATUS_LABELS.get(k, k)} {s:.0f}s"
            for k, s in sorted(v.get("statusSeconds", {}).items(), key=lambda kv: -kv[1])
            if s >= 0.5
        )
        evidence = ", ".join(f"{e}" for e, _ in v.get("topEvidence", [])[:3]) or "—"
        limits = ", ".join(f"{e}" for e, _ in v.get("topLimitations", [])[:3]) or "—"
        peaks = ", ".join(f"{g} {p:.2f}" for g, p in sorted(v.get("groupPeaks", {}).items(),
                                                             key=lambda kv: -kv[1])) or "—"
        if v["id"] in notes.get("snapshot_ids", []):
            snapshot = image_tag(images / f"{v['id']}_peak.jpg")
        else:
            snapshot = "<p class='meta'>Snapshot omitted: real, identifiable person.</p>"
        comment = notes.get("clip_comments", {}).get(v["id"], "")
        parts.append(
            f"<div class='card'><h3>{esc(v['title'])} — <span class='{cls}'>{esc(text)}</span></h3>"
            f"<div class='meta'>{esc(v['label'])} · {esc(v.get('license', ''))} · "
            f"<a href='{esc(v.get('page', ''))}'>source</a></div>"
            f"{timeline_svg(v.get('timeline', []))}"
            f"<div class='grid2'><div>"
            f"<b>Highest status:</b> {pill(v.get('peakStatus', 'NO_PERSON'))}<br/>"
            f"<b>Time in each status:</b> {esc(status_time)}<br/>"
            f"<b>Image quality (0–1):</b> {v.get('meanQuality', 0):.2f} · "
            f"<b>Face visible:</b> {v.get('faceVisibleFraction', 0) * 100:.0f}% · "
            f"<b>Full body visible:</b> {v.get('gaitVisibleFraction', 0) * 100:.0f}%<br/>"
            f"<b>Strongest signals:</b> {esc(peaks)}<br/>"
            f"<b>Main evidence shown:</b> {esc(evidence)}<br/>"
            f"<b>Main limitations shown:</b> {esc(limits)}"
            f"{'<p>' + comment + '</p>' if comment else ''}"
            f"</div><div>{snapshot}</div></div></div>"
        )

    for section in notes["sections_after"]:
        parts.append(section)

    if ms:
        parts.append(
            f"<p class='meta'>Processing cost during this run: {min(ms):.0f}–{max(ms):.0f} ms "
            "per frame on CPU.</p>"
        )
    parts.append("</body></html>")
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    parser.add_argument("--images", required=True)
    parser.add_argument("--notes", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    videos = json.loads(Path(args.report).read_text())
    notes = json.loads(Path(args.notes).read_text())
    Path(args.out).write_text(render(videos, Path(args.images), notes))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
