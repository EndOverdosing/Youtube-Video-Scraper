FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY . /app

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8080

ENV NAME World

CMD ["gunicorn", "--workers", "2", "--timeout", "120", "--bind", "0.0.0.0:8080", "header:app"]