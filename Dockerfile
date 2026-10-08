FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt \
    && addgroup --system fixembed \
    && adduser --system --ingroup fixembed fixembed \
    && chown fixembed:fixembed /app

COPY --chown=fixembed:fixembed . .

USER fixembed

CMD ["python3", "main.py"]
