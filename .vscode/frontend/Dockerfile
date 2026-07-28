# Use a base Python image
FROM python:3.11-slim

# Set the directory inside the container where everything will live
WORKDIR /app

# 1. CRUCIAL: Copy requirements first and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. CRUCIAL: Copy ALL your local files (including app.py) into the container
COPY . .

# Expose the Cloud Run port
EXPOSE 8080

# Run the app
CMD ["streamlit", "run", "app.py", "--server.port=8080", "--server.address=0.0.0.0"]