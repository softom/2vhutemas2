# Образ API нового контура: Deno + обработка изображений.
# ImageMagick нужен для экранной версии и превью, ghostscript — для первой
# страницы PDF. Состав повторяет образ существующего медиасервиса, чтобы
# производные получались одинаковыми.
FROM denoland/deno:alpine-2.1.7

RUN apk add --no-cache imagemagick imagemagick-heic imagemagick-webp ghostscript ghostscript-fonts \
  && for p in /etc/ImageMagick-7/policy.xml /etc/ImageMagick-6/policy.xml; do \
       [ -f "$p" ] && sed -i 's#<policy domain="coder" rights="none" pattern="PDF" />#<policy domain="coder" rights="read|write" pattern="PDF" />#' "$p" || true; \
     done

# В образе Deno своя libgcc, она перекрывает системную и ломает запуск
# ImageMagick. Обёртка подставляет системные библиотеки — благодаря ей сервису
# достаточно права запускать один известный файл, а не любые программы.
RUN { echo '#!/bin/sh'; \
      echo 'export LD_LIBRARY_PATH=/usr/lib'; \
      echo 'exec /usr/bin/magick "$@"'; } > /usr/local/bin/magickw \
  && chmod +x /usr/local/bin/magickw

WORKDIR /app
COPY deno.json /app/deno.json
COPY src /app/src
RUN deno cache src/main.ts || true

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write=/data,/tmp", "--allow-run=/usr/local/bin/magickw", "src/main.ts"]
