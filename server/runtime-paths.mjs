import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const runtimeRoot=()=>path.resolve(process.env.MUSE_RUNTIME_DIR||path.join(ROOT,'tools','standalone'));
export function mediaPaths(){const root=runtimeRoot();return {python:process.env.MUSE_PYTHON||path.join(root,'python','python.exe'),ffmpeg:process.env.MUSE_FFMPEG||path.join(root,'ffmpeg','bin','ffmpeg.exe'),ffprobe:process.env.MUSE_FFPROBE||path.join(root,'ffmpeg','bin','ffprobe.exe')};}
