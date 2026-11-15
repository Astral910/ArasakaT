#!/usr/bin/env bash
# Corta el video de 30 s de la entrega a partir de la toma de record-flujo.mjs (Git Bash, ffmpeg con NVENC y libass).
# Uso: bash cortar-entrega.sh <carpeta con flujo.mp4, tel-alerta.png, subs.srt> <comparar.mp4> <salida.mp4>
# Los tiempos (-ss) salen de marcas.json de la toma del 14-nov (landing 0 · ver 7.7 · guía 27.9 · final 77.3 · informe 80.9).
set -e
T=$1; CMP=$2; OUT=$3; cd "$T"
F="C\:/Windows/Fonts/segoeuib.ttf"; FR="C\:/Windows/Fonts/georgiab.ttf"
ENC="-c:v h264_nvenc -preset p7 -rc vbr -cq 19 -b:v 0 -pix_fmt yuv420p -an"; V="fps=30,scale=1920:1080:flags=lanczos,format=yuv420p"
q(){ ffmpeg -y -hide_banner -loglevel error "$@"; }
q -f lavfi -i "color=c=0x15110d:s=1920x1080:d=2:r=30" -vf "drawtext=fontfile='$FR':text='Field Shift':fontcolor=0xf4ebdb:fontsize=120:x=(w-tw)/2:y=(h-th)/2-50:alpha='min(1,t/0.5)',drawtext=fontfile='$F':text='NASA Space Apps 2026 · Guatemala':fontcolor=0xe0a526:fontsize=44:x=(w-tw)/2:y=(h)/2+60:alpha='min(1,t/0.5)'" $ENC s1.mp4
q -ss 0.4 -t 7.5 -i flujo.mp4 -vf "setpts=PTS/1.5,$V" $ENC s2.mp4
q -ss 14 -t 14 -i flujo.mp4 -vf "setpts=PTS/3.5,$V" $ENC s3.mp4
q -ss 28 -t 49.2 -i flujo.mp4 -vf "setpts=PTS/6.15,$V" $ENC s4.mp4
q -ss 0.6 -t 2.5 -i "$CMP" -vf "$V" $ENC s5.mp4
q -ss 77.6 -t 3.3 -i flujo.mp4 -vf "setpts=PTS/1.32,$V" $ENC s6.mp4
q -ss 80.9 -t 3.6 -i flujo.mp4 -vf "setpts=PTS/1.44,$V" -t 2.5 $ENC s7.mp4
q -ss 60 -i flujo.mp4 -loop 1 -t 2 -i tel-alerta.png -filter_complex "[0:v]trim=0:2,setpts=PTS-STARTPTS,scale=1920:1080,boxblur=18:2,eq=brightness=-0.12[bg];[1:v]crop=iw:ih-70:0:70,scale=-1:980[t];[bg][t]overlay=(W-w)/2:50,$V" -t 2 $ENC s8.mp4
q -f lavfi -i "color=c=0x15110d:s=1920x1080:d=1.5:r=30" -vf "drawtext=fontfile='$FR':text='Field Shift':fontcolor=0xf4ebdb:fontsize=96:x=(w-tw)/2:y=(h-th)/2-70,drawtext=fontfile='$F':text='Free · WhatsApp + web · anywhere on Earth':fontcolor=0xe0a526:fontsize=40:x=(w-tw)/2:y=h/2+30,drawtext=fontfile='$F':text='NASA POWER · GPM IMERG · MODIS · SRTM · NEX-GDDP-CMIP6':fontcolor=0xd2c3ab:fontsize=32:x=(w-tw)/2:y=h/2+100" $ENC s9.mp4
for i in 1 2 3 4 5 6 7 8 9; do echo "file 's$i.mp4'"; done > lista.txt
q -f concat -safe 0 -i lista.txt -c copy crudo.mp4
q -i crudo.mp4 -vf "subtitles=subs.srt:fontsdir='C\:/Windows/Fonts':force_style='FontName=Segoe UI,Bold=1,FontSize=14,PrimaryColour=&H00F0FAFF,OutlineColour=&H30140F0C,BackColour=&H30140F0C,BorderStyle=3,Outline=3,Shadow=0,Alignment=6,MarginV=22'" -c:v h264_nvenc -preset p7 -tune hq -rc vbr -b:v 7M -maxrate 10M -bufsize 14M -profile:v high -pix_fmt yuv420p -movflags +faststart -an "$OUT"
echo "listo: $OUT"
