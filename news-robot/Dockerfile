# Робот новостей — контейнер для запуска по расписанию (WIKI/Новости — робот, цепочка и промпты).
# Код, состояние и прогоны — в смонтированной папке /robot; настройки проекта — /config.
FROM python:3.12-slim
WORKDIR /robot
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
CMD ["python", "run.py"]
