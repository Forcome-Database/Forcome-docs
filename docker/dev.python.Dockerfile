FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    fonts-dejavu-core \
    libjpeg-dev \
    zlib1g-dev \
    libfreetype-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached unless pyproject.toml changes)
COPY pyproject.toml .
RUN mkdir -p app && touch app/__init__.py && pip install . && rm -rf app

# Source code mounted via volume at runtime, this layer is just a fallback
COPY app/ ./app/
