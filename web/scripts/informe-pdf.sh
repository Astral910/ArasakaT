#!/bin/sh
# uso: informe-pdf.sh "<query>" <salida.pdf>  (servidor en 8205, caché borrada antes)
rm -rf "$TEMP/informe-srv/cache"
curl -s -o "$2" -w "%{http_code} %{size_download} bytes %{time_total}s\n" "http://127.0.0.1:8205/api/informe.pdf?$1"
python -c "
import fitz,sys
from PIL import Image
d=fitz.open(sys.argv[1]);print('paginas',d.page_count)
ims=[]
for p in d:
  pix=p.get_pixmap(dpi=55); ims.append(Image.frombytes('RGB',[pix.width,pix.height],pix.samples))
w,h=ims[0].size;cols=6;rows=(len(ims)+cols-1)//cols
s=Image.new('RGB',(cols*w,rows*h),'#888')
for i,im in enumerate(ims): s.paste(im,((i%cols)*w,(i//cols)*h))
s.save(sys.argv[1].replace('.pdf','-hojas.png'))
" "$2"
