FROM node:20-bookworm-slim

WORKDIR /app

# libreoffice-calc-nogui + fonts-nanum: 거래 문서를 엑셀 그대로 PDF로 변환한다
# (GUI/자바 없는 최소 구성). fonts-nanum이 없으면 PDF의 한글이 통째로 깨진다.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-pip python3-openpyxl python3-pil \
       libreoffice-calc-nogui fonts-nanum fontconfig \
  && rm -rf /var/lib/apt/lists/*

COPY docker/fontconfig-korean.conf /etc/fonts/conf.d/99-wooofpay-korean.conf
# 폰트 대체가 깨져도 변환은 오류 없이 "성공"하고 한글만 빈칸인 PDF가 나간다.
# 그런 배포가 나가지 않도록, 대체가 실제로 걸리는지 빌드 때 확인하고 실패시킨다.
RUN fc-cache -f \
  && fc-match "맑은 고딕" | grep -qi nanum \
  && soffice --version

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

CMD ["npm", "start"]
