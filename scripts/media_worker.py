"""Owned-input media operations. Invoked by server/media.mjs, never by submitted code."""
import asyncio
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time


class Cancelled(Exception):
    pass


CFG = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
WORK = Path(CFG["workdir"])
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def check_cancel():
    heartbeat = WORK / "heartbeat"
    if (WORK / "cancel.flag").exists() or not heartbeat.exists() or time.time() - heartbeat.stat().st_mtime > 20:
        raise Cancelled()


def progress(phase, percent=None):
    value = {"phase": phase}
    if percent is not None:
        value["percent"] = round(percent, 1)
    temp = WORK / "progress.tmp"
    temp.write_text(json.dumps(value), encoding="utf-8")
    temp.replace(WORK / "progress.json")


def run(args, timeout=10800):
    check_cancel()
    with (WORK / "worker.log").open("ab") as log:
        proc = subprocess.Popen(args, cwd=WORK, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=FLAGS)
        started = time.monotonic()
        try:
            while proc.poll() is None:
                check_cancel()
                if time.monotonic() - started > timeout:
                    raise RuntimeError("Xử lý media vượt giới hạn 3 giờ.")
                time.sleep(.15)
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        if proc.returncode:
            text = (WORK / "worker.log").read_bytes()[-6000:].decode("utf-8", errors="replace")
            raise RuntimeError("FFmpeg không hoàn tất: " + text)


def silence_span(file, length):
    """Conservative edge-only silence trim; never removes silence between words."""
    log = WORK / "worker.log"
    offset = log.stat().st_size if log.exists() else 0
    run([CFG["ffmpeg"], "-nostdin", "-hide_banner", "-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"])
    with log.open("rb") as stream:
        stream.seek(offset)
        text = stream.read().decode("utf-8", errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", text)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", text)]
    start = max(0, ends[0] - .1) if starts and starts[0] < .05 and ends else 0
    end = min(length, starts[-1] + .15) if starts and ends and ends[-1] >= length - .1 else length
    return (start, end) if end - start >= .3 else (0, length)


def ff(args):
    run([CFG["ffmpeg"], "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-filter_threads", "2", "-filter_complex_threads", "2"] + args)


def probe(file):
    check_cancel()
    p = subprocess.run([CFG["ffprobe"], "-v", "error", "-show_format", "-show_streams", "-of", "json", str(file)], capture_output=True, creationflags=FLAGS, timeout=30)
    if p.returncode:
        raise RuntimeError("Không đọc được media nguồn.")
    obj = json.loads(p.stdout)
    if not obj.get("streams"):
        raise RuntimeError("Tệp không có luồng âm thanh/video.")
    return obj


def duration(info):
    return float(info.get("format", {}).get("duration", 0))


def result_for(file, mime):
    info = probe(WORK / file)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    result = {"file": file, "mime": mime, "duration": duration(info), "bytes": (WORK / file).stat().st_size, "hasAudio": any(s["codec_type"] == "audio" for s in info["streams"])}
    if video:
        a, b = video.get("avg_frame_rate", "0/1").split("/")
        result.update(width=video["width"], height=video["height"], fps=float(a) / max(float(b), 1), codec=video["codec_name"])
    return result


async def tts():
    import edge_tts
    progress("Đang tạo lời đọc qua Edge TTS")
    communicate = edge_tts.Communicate(CFG["text"], CFG["voice"], rate=f'{CFG["rate"]:+g}%', volume=f'{CFG["volume"]:+g}%', pitch=f'{CFG["pitch"]:+g}Hz')
    maker = edge_tts.SubMaker()

    async def generate():
        with (WORK / "narration.mp3").open("wb") as out:
            async for chunk in communicate.stream():
                check_cancel()
                if chunk["type"] == "audio":
                    out.write(chunk["data"])
                elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                    maker.feed(chunk)
        (WORK / "subtitles.srt").write_text(maker.get_srt(), encoding="utf-8")

    task = asyncio.create_task(generate())
    started = time.monotonic()
    try:
        while not task.done():
            check_cancel()
            if time.monotonic() - started > 1800:
                raise RuntimeError("Dịch vụ TTS vượt giới hạn chờ 30 phút; không tự gửi lại.")
            await asyncio.sleep(.2)
        await task
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    result = result_for("narration.mp3", "audio/mpeg")
    if not (WORK / "subtitles.srt").read_text(encoding="utf-8").strip():
        raise RuntimeError("Dịch vụ TTS không trả thời gian phụ đề; âm thanh chưa được đánh dấu hoàn tất.")
    result["artifacts"] = {"subtitle": "subtitles.srt"}
    result["provider"] = "edge-tts"
    return result


def render():
    infos = [probe(p) for p in CFG["sources"]]
    if any(not any(s["codec_type"] == "video" for s in i["streams"]) or duration(i) <= 0 for i in infos):
        raise RuntimeError("Mỗi cảnh cần video có thời lượng hợp lệ.")
    first = next(s for s in infos[0]["streams"] if s["codec_type"] == "video")
    w, h = first["width"], first["height"]
    rotation = next((s.get("rotation", 0) for s in first.get("side_data_list", []) if "rotation" in s), first.get("tags", {}).get("rotate", 0))
    if round(float(rotation)) % 180:
        w, h = h, w
    target = {"720p": 720, "1080p": 1080, "4k": 2160}.get(CFG["resolution"])
    if target:
        scale = target / min(w, h)
        w, h = round(w * scale / 2) * 2, round(h * scale / 2) * 2
    else:
        w, h = (w // 2) * 2, (h // 2) * 2
    fps = CFG["fps"]
    lengths, trims = [], []
    for index, (file, info) in enumerate(zip(CFG["sources"], infos)):
        progress(f"Chuẩn hóa cảnh {index+1}/{len(infos)}", index / len(infos) * 55)
        start, end = 0, duration(info)
        has_audio = any(s["codec_type"] == "audio" for s in info["streams"])
        if CFG.get("trimSilence") and has_audio:
            start, end = silence_span(file, end)
        speed = CFG.get("speed", 1)
        length = (end - start) / speed
        trims.append({"sourceStart": round(start, 3), "sourceEnd": round(end, 3), "speed": speed})
        lengths.append(length)
        args = ["-ss", str(start), "-i", file]
        if not has_audio:
            args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=(PTS-STARTPTS)/{speed}"
        if CFG["interpolate"]:
            vf += f",minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,tpad=stop_mode=clone:stop_duration=0.2"
        else:
            vf += f",fps={fps}"
        af = f"aresample=48000,atempo={speed},apad,atrim=0:{length},asetpts=PTS-STARTPTS"
        if CFG.get("fadeEdges", True):
            af += f",afade=t=in:st=0:d=0.025,afade=t=out:st={max(0,length-.04)}:d=0.04"
        args += ["-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0", "-vf", vf, "-af", af, "-t", str(length), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", f"clip-{index}.mp4"]
        ff(args)
    transition = CFG["transition"]
    overlap = transition["duration"] if transition["type"] != "none" else 0
    if overlap and any(v <= overlap * 2 for v in lengths):
        raise RuntimeError("Cảnh quá ngắn cho chuyển cảnh; giảm thời lượng chuyển cảnh.")
    progress("Ghép các cảnh", 60)
    if overlap and len(infos) > 1:
        args = []
        for i in range(len(infos)):
            args += ["-i", f"clip-{i}.mp4"]
        filters, vl, al, elapsed = [], "0:v", "0:a", lengths[0]
        for i in range(1, len(infos)):
            filters += [f"[{vl}][{i}:v]xfade=transition={transition['type']}:duration={overlap}:offset={elapsed-overlap}[v{i}]", f"[{al}][{i}:a]acrossfade=d={overlap}:c1=tri:c2=tri[a{i}]"]
            vl, al, elapsed = f"v{i}", f"a{i}", elapsed + lengths[i] - overlap
        ff(args + ["-filter_complex", ";".join(filters), "-map", f"[{vl}]", "-map", f"[{al}]", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "joined.mp4"])
    else:
        (WORK / "concat.txt").write_text("\n".join(f"file 'clip-{i}.mp4'" for i in range(len(infos))), encoding="utf-8")
        ff(["-f", "concat", "-safe", "1", "-i", "concat.txt", "-c", "copy", "joined.mp4"])
    total = duration(probe(WORK / "joined.mp4"))
    if CFG.get("narration") and duration(probe(CFG["narration"])) > total + .25:
        raise RuntimeError("Lời đọc dài hơn video. Thêm cảnh hoặc rút ngắn lời đọc trước khi render; không tự cắt mất lời.")
    args, filters, mix, index = ["-i", "joined.mp4"], [f"[0:a]volume={CFG['originalGain']}[original]"], ["[original]"], 1
    narration_label = None
    if CFG.get("narration"):
        args += ["-i", CFG["narration"]]
        filters += [f"[{index}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:{total},asetpts=PTS-STARTPTS,volume={CFG['narrationGain']}[voice]"]
        narration_label, index = "voice", index + 1
    if CFG.get("music"):
        args += ["-stream_loop", "-1", "-i", CFG["music"]]
        filters += [f"[{index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{total},asetpts=PTS-STARTPTS,volume={CFG['musicGain']},afade=t=out:st={max(0,total-.8)}:d=0.8[music]"]
        if CFG["duckMusic"]:
            if narration_label:
                filters += ["[voice]asplit=2[voice_mix][voice_side]"]
                narration_label = "voice_mix"
            else:
                filters += ["[original]asplit=2[original_mix][voice_side]"]
                mix[0] = "[original_mix]"
            filters += ["[music][voice_side]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[ducked]"]
            mix += ["[ducked]"]
        else:
            mix += ["[music]"]
    if narration_label:
        mix += [f"[{narration_label}]"]
    normalize = ",loudnorm=I=-16:TP=-1.5:LRA=11" if CFG.get("normalizeLoudness") else ""
    filters += [f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0{normalize},alimiter=limit=0.95[aout]"]
    captions = CFG.get("captions")
    artifacts = {}
    if isinstance(captions, str) and captions.strip():
        (WORK / "subtitles.srt").write_text(captions, encoding="utf-8")
        filters += ["[0:v]subtitles=filename=subtitles.srt:force_style='FontName=Arial,FontSize=20,Outline=1,MarginV=24'[vout]"]
        artifacts["subtitle"] = "subtitles.srt"
    progress("Trộn âm thanh và xuất video", 80)
    ff(args + ["-filter_complex", ";".join(filters), "-map", "[vout]" if artifacts else "0:v:0", "-map", "[aout]", "-t", str(total), "-c:v", "libx264" if artifacts else "copy"] + (["-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p"] if artifacts else []) + ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "video.mp4"])
    result = result_for("video.mp4", "video/mp4")
    result.update(artifacts=artifacts, interpolation="optical-flow" if CFG["interpolate"] else "frame-rate conversion", scaling="Lanczos; not AI super-resolution", clips=len(infos), trims=trims, loudness="single-pass EBU R128 -16 LUFS target" if CFG.get("normalizeLoudness") else "unchanged")
    for temporary in [*(f"clip-{i}.mp4" for i in range(len(infos))), "joined.mp4", "concat.txt"]:
        (WORK / temporary).unlink(missing_ok=True)
    return result


def frame():
    info = probe(CFG["source"])
    if not any(s["codec_type"] == "video" for s in info["streams"]):
        raise RuntimeError("Nguồn không có video.")
    if CFG["seconds"] >= duration(info) and duration(info) > 0:
        raise RuntimeError("Vị trí frame phải nhỏ hơn thời lượng video.")
    progress("Trích frame")
    ff(["-ss", str(CFG["seconds"]), "-i", CFG["source"], "-frames:v", "1", "-q:v", "2", "frame.jpg"])
    return result_for("frame.jpg", "image/jpeg")


def references():
    """Fit preserves the entire subject; blurred duplicate fills the portrait canvas."""
    def fit(file, width, height, output):
        probe(file)
        filters = f"[0:v]split=2[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma=25[background];[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[foreground];[background][foreground]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
        ff(["-i", file, "-filter_complex", filters, "-map", "[v]", "-frames:v", "1", output])

    artifacts = {"product": "product.png"}
    if CFG.get("kolAssetFile"):
        progress("Chuẩn bị ảnh KOL 9:16", 10)
        fit(CFG["kolAssetFile"], 720, 1280, "kol.png")
        artifacts["kol"] = "kol.png"
    progress("Chuẩn bị ảnh sản phẩm 9:16", 45)
    if CFG.get("detailAssetFile"):
        fit(CFG["productAssetFile"], 720, 768, "product-main.png")
        fit(CFG["detailAssetFile"], 720, 512, "product-detail.png")
        ff(["-i", "product-main.png", "-i", "product-detail.png", "-filter_complex", "[0:v][1:v]vstack=inputs=2[v]", "-map", "[v]", "-frames:v", "1", "product.png"])
        (WORK / "product-main.png").unlink()
        (WORK / "product-detail.png").unlink()
    else:
        fit(CFG["productAssetFile"], 720, 1280, "product.png")
    result = result_for("product.png", "image/png")
    result.update(artifacts=artifacts, layout="main 60% / detail 40%" if CFG.get("detailAssetFile") else "portrait contain", processing="Whole-image fit with blurred background; no AI edits or subject crop")
    return result


try:
    result = asyncio.run(tts()) if CFG["kind"] == "tts" else render() if CFG["kind"] == "render" else references() if CFG["kind"] == "references" else frame()
    check_cancel()
    (WORK / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
except Cancelled:
    sys.exit(130)
except Exception as error:
    (WORK / "failure.json").write_text(json.dumps({"error": str(error)}, ensure_ascii=False), encoding="utf-8")
    sys.exit(1)
