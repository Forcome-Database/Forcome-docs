FROM python:3.12-slim

WORKDIR /app

# China apt mirror + system deps
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    fonts-dejavu-core \
    libjpeg-dev \
    zlib1g-dev \
    libfreetype-dev \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (cached unless pyproject.toml changes)
COPY pyproject.toml .
RUN mkdir -p app && touch app/__init__.py \
    && pip install -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com .

# Copy source after deps are installed
COPY app/ ./app/

ENV AGENT_PORT=8100
EXPOSE ${AGENT_PORT}
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${AGENT_PORT} --workers 1"
